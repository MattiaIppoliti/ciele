import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PostgREST shim: a `SupabaseClient` look-alike that translates the
 * query-builder subset `createSupabaseDb` actually uses into SQL executed on
 * an in-process PGlite instance (ADR-0016 stage 2).
 *
 * This exists so `describeDbContract("supabase", …)` can run the REAL
 * Supabase adapter against the REAL migrations without Docker or a live
 * project. It is test infra, deliberately partial: it supports exactly the
 * builder surface the adapter uses (select/insert/update/delete/upsert;
 * eq/is/in/gt/lt/gte/lte/or; order/limit/range; single/maybeSingle; count+head;
 * embedded resources incl. `!inner` and dotted filters; rpc via pg_proc
 * introspection; auth.getUser). Anything else throws loudly.
 *
 * NOT covered on purpose: RLS enforcement. PGlite runs as the table owner,
 * so policies do not filter rows here, the contract pins interface
 * semantics (defaults, patches, cascades, scoping via explicit filters),
 * not tenant isolation. RLS behavior stays a live-project concern.
 */

interface ShimUser {
  id: string;
  email: string;
}

interface ColumnInfo {
  dataType: string;
  udtName: string;
}

type Row = Record<string, unknown>;

interface EmbedSpec {
  /** Embedded relation (table) name as written in the select string. */
  table: string;
  /** Columns requested inside the parens ("*" allowed). */
  columns: string;
  inner: boolean;
}

interface ParsedSelect {
  /** Plain column expressions for the main table ("*" allowed). */
  columns: string[];
  embeds: EmbedSpec[];
}

interface Filter {
  kind: "eq" | "is" | "in" | "gt" | "lt" | "gte" | "lte" | "or";
  /** For dotted paths ("assistants.organization_id") the embed table. */
  embed?: string;
  column: string;
  value: unknown;
}

interface ForeignKey {
  /** Table holding the FK column. */
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`postgrest-shim: unsafe identifier ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/**
 * A filter column: a plain identifier, or a PostgREST JSON-path filter
 * (`jsonb_col->>key`), which PostgREST accepts in `.eq()` and friends.
 */
function quoteColumn(name: string): string {
  const jsonPath = /^([a-z_][a-z0-9_]*)->>([A-Za-z0-9_-]+)$/.exec(name);
  if (jsonPath) return `${quoteIdent(jsonPath[1])}->>'${jsonPath[2]}'`;
  return quoteIdent(name);
}

/** Split a PostgREST select string on top-level commas. */
function splitTopLevel(select: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of select) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseSelect(select: string): ParsedSelect {
  const columns: string[] = [];
  const embeds: EmbedSpec[] = [];
  for (const part of splitTopLevel(select)) {
    // Greedy body match: the embed's column list may itself contain nested
    // embeds ("messages(*, conversations(*, assistants(title)))").
    const embed = part.match(/^([a-z0-9_]+)(!inner)?\s*\(([\s\S]*)\)$/);
    if (embed) {
      embeds.push({ table: embed[1], inner: Boolean(embed[2]), columns: embed[3].trim() });
    } else {
      columns.push(part);
    }
  }
  return { columns, embeds };
}

class ShimError extends Error {
  code: string;
  details: string | null;
  constructor(message: string, code: string, details: string | null = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** PostgREST speaks JSON: PGlite's JS `Date` values become ISO strings. */
function jsonify<T>(value: T): T {
  if (value instanceof Date) return value.toISOString() as unknown as T;
  if (Array.isArray(value)) return value.map(jsonify) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, jsonify(v)])
    ) as unknown as T;
  }
  return value;
}

function toShimError(err: unknown): ShimError {
  const e = err as { message?: string; code?: string; detail?: string };
  return new ShimError(
    e.message ?? String(err),
    e.code ?? "XX000",
    e.detail ?? null
  );
}

export class PgliteRest {
  private columnCache = new Map<string, Map<string, ColumnInfo>>();
  private fkCache = new Map<string, ForeignKey | null>();

  constructor(
    private pg: PGlite,
    private user: ShimUser
  ) {}

  async columns(table: string): Promise<Map<string, ColumnInfo>> {
    let cached = this.columnCache.get(table);
    if (!cached) {
      const res = await this.pg.query<{
        column_name: string;
        data_type: string;
        udt_name: string;
      }>(
        `select column_name, data_type, udt_name
           from information_schema.columns
          where table_schema = 'public' and table_name = $1`,
        [table]
      );
      cached = new Map(
        res.rows.map((r) => [
          r.column_name,
          { dataType: r.data_type, udtName: r.udt_name },
        ])
      );
      if (cached.size === 0) {
        throw new Error(`postgrest-shim: unknown table public.${table}`);
      }
      this.columnCache.set(table, cached);
    }
    return cached;
  }

  /** FK between two tables, either direction (cached). */
  async foreignKey(a: string, b: string): Promise<ForeignKey> {
    const key = `${a}→${b}`;
    let fk = this.fkCache.get(key);
    if (fk === undefined) {
      const res = await this.pg.query<{
        from_table: string;
        from_column: string;
        to_table: string;
        to_column: string;
      }>(
        `select rel.relname as from_table,
                att.attname as from_column,
                frel.relname as to_table,
                fatt.attname as to_column
           from pg_constraint c
           join pg_class rel on rel.oid = c.conrelid
           join pg_class frel on frel.oid = c.confrelid
           join pg_attribute att
             on att.attrelid = c.conrelid and att.attnum = c.conkey[1]
           join pg_attribute fatt
             on fatt.attrelid = c.confrelid and fatt.attnum = c.confkey[1]
          where c.contype = 'f'
            and ((rel.relname = $1 and frel.relname = $2)
              or (rel.relname = $2 and frel.relname = $1))`,
        [a, b]
      );
      fk = res.rows[0]
        ? {
            fromTable: res.rows[0].from_table,
            fromColumn: res.rows[0].from_column,
            toTable: res.rows[0].to_table,
            toColumn: res.rows[0].to_column,
          }
        : null;
      this.fkCache.set(key, fk);
    }
    if (!fk) throw new Error(`postgrest-shim: no FK between ${a} and ${b}`);
    return fk;
  }

  /** Encode a JS value for a column, returning the SQL expression + params. */
  encodeValue(
    value: unknown,
    info: ColumnInfo | undefined,
    params: unknown[]
  ): string {
    if (value === null || value === undefined) return "null";
    if (!info) {
      params.push(value);
      return `$${params.length}`;
    }
    if (info.dataType === "ARRAY") {
      // e.g. text[], go through jsonb so the JS array survives verbatim.
      const element = info.udtName.replace(/^_/, "");
      params.push(JSON.stringify(value));
      return `(select coalesce(array_agg(e.value #>> '{}'), '{}') from jsonb_array_elements($${params.length}::jsonb) e)::${element}[]`;
    }
    if (info.udtName === "vector") {
      params.push(JSON.stringify(value));
      return `$${params.length}::vector`;
    }
    if (info.dataType === "jsonb" || info.dataType === "json") {
      params.push(JSON.stringify(value));
      return `$${params.length}::${info.dataType}`;
    }
    params.push(value);
    return `$${params.length}`;
  }

  from(table: string): ShimQueryBuilder {
    return new ShimQueryBuilder(this, this.pg, table);
  }

  async rpc(fn: string, args: Record<string, unknown> = {}) {
    try {
      // IN parameters only: when a function has OUT/TABLE params,
      // proargnames covers ALL of them (aligned with proallargtypes), so the
      // IN args must be picked out via proargmodes.
      const proc = await this.pg.query<{
        name: string;
        type: string;
        retset: boolean;
        retcomposite: boolean;
      }>(
        `select a.name, a.type, p.proretset as retset, (t.typtype = 'c') as retcomposite
           from pg_proc p
           join pg_type t on t.oid = p.prorettype
           join pg_namespace n on n.oid = p.pronamespace
           left join lateral (
             select p.proargnames[i] as name,
                    coalesce(p.proallargtypes[i], p.proargtypes[i - 1])::regtype::text as type,
                    i
               from generate_series(1, coalesce(array_length(p.proallargtypes, 1), p.pronargs)) i
              where p.proargmodes is null or p.proargmodes[i] in ('i', 'b', 'v')
           ) a on true
          where n.nspname = 'public' and p.proname = $1
          order by a.i`,
        [fn]
      );
      if (proc.rows.length === 0) {
        throw new ShimError(`function public.${fn} does not exist`, "42883");
      }
      const inArgs = proc.rows.filter((r) => r.name != null);
      const names = inArgs.map((r) => r.name);
      const types = inArgs.map((r) => r.type);
      const row = proc.rows[0];
      const params: unknown[] = [];
      const argExprs = names.map((name, i) => {
        const value = args[name];
        const type = types[i] ?? "text";
        if (value === null || value === undefined) return `null::${type}`;
        if (
          type === "jsonb" ||
          type === "json" ||
          type === "vector" ||
          type.endsWith("[]")
        ) {
          params.push(JSON.stringify(value));
          return type.endsWith("[]")
            ? `(select coalesce(array_agg(e.value #>> '{}'), '{}') from jsonb_array_elements($${params.length}::jsonb) e)::${type}`
            : `$${params.length}::${type}`;
        }
        params.push(value);
        return `$${params.length}::${type}`;
      });
      const call = `public.${quoteIdent(fn)}(${argExprs.join(", ")})`;
      if (row.retset || row.retcomposite) {
        const res = await this.pg.query<Row>(`select * from ${call}`, params);
        return { data: jsonify(res.rows), error: null };
      }
      const res = await this.pg.query<{ v: unknown }>(
        `select ${call} as v`,
        params
      );
      return { data: jsonify(res.rows[0]?.v ?? null), error: null };
    } catch (err) {
      if ((err as Error).message?.startsWith("postgrest-shim:")) throw err;
      return { data: null, error: toShimError(err) };
    }
  }

  get auth() {
    const user = this.user;
    return {
      async getUser() {
        return { data: { user }, error: null };
      },
    };
  }
}

type Mode =
  | { op: "select" }
  | { op: "insert"; values: Row | Row[] }
  | { op: "update"; values: Row }
  | { op: "upsert"; values: Row | Row[]; onConflict: string }
  | { op: "delete" };

class ShimQueryBuilder implements PromiseLike<{
  data: unknown;
  error: ShimError | null;
  count: number | null;
}> {
  private mode: Mode = { op: "select" };
  private selectStr: string | null = null;
  private countMode: "exact" | null = null;
  private headMode = false;
  private filters: Filter[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;

  constructor(
    private rest: PgliteRest,
    private pg: PGlite,
    private table: string
  ) {}

  select(
    columns = "*",
    options?: { count?: "exact"; head?: boolean }
  ): this {
    this.selectStr = columns;
    if (options?.count) this.countMode = options.count;
    if (options?.head) this.headMode = true;
    return this;
  }

  insert(values: Row | Row[]): this {
    this.mode = { op: "insert", values };
    return this;
  }

  update(values: Row): this {
    this.mode = { op: "update", values };
    return this;
  }

  upsert(values: Row | Row[], options?: { onConflict?: string }): this {
    if (!options?.onConflict) {
      throw new Error("postgrest-shim: upsert requires onConflict");
    }
    this.mode = { op: "upsert", values, onConflict: options.onConflict };
    return this;
  }

  delete(): this {
    this.mode = { op: "delete" };
    return this;
  }

  private pushFilter(kind: Filter["kind"], column: string, value: unknown): this {
    const dot = column.indexOf(".");
    if (dot !== -1) {
      this.filters.push({
        kind,
        embed: column.slice(0, dot),
        column: column.slice(dot + 1),
        value,
      });
    } else {
      this.filters.push({ kind, column, value });
    }
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.pushFilter("eq", column, value);
  }
  is(column: string, value: null): this {
    return this.pushFilter("is", column, value);
  }
  in(column: string, values: unknown[]): this {
    return this.pushFilter("in", column, values);
  }
  gt(column: string, value: unknown): this {
    return this.pushFilter("gt", column, value);
  }
  lt(column: string, value: unknown): this {
    return this.pushFilter("lt", column, value);
  }
  gte(column: string, value: unknown): this {
    return this.pushFilter("gte", column, value);
  }
  lte(column: string, value: unknown): this {
    return this.pushFilter("lte", column, value);
  }
  /** PostgREST or-string: "col.op.value,col.op.value" (op: is/eq/lte/gte/ilike). */
  or(conditions: string): this {
    return this.pushFilter("or", "", conditions);
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  range(from: number, to: number): this {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }

  single(): this {
    this.singleMode = "single";
    return this;
  }

  maybeSingle(): this {
    this.singleMode = "maybeSingle";
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown;
          error: ShimError | null;
          count: number | null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async whereSql(
    params: unknown[],
    alias: string
  ): Promise<string> {
    const clauses: string[] = [];
    for (const f of this.filters) {
      if (f.embed) {
        // Dotted filter: constrain through the FK (adapter uses these only
        // with !inner embeds, semantically an inner-join condition).
        const fk = await this.rest.foreignKey(this.table, f.embed);
        const embedCols = await this.rest.columns(f.embed);
        const [local, remote] =
          fk.fromTable === this.table
            ? [fk.fromColumn, fk.toColumn]
            : [fk.toColumn, fk.fromColumn];
        const expr = this.rest.encodeValue(f.value, embedCols.get(f.column), params);
        clauses.push(
          `exists (select 1 from ${quoteIdent(f.embed)} e_${f.embed}
             where e_${f.embed}.${quoteIdent(remote)} = ${alias}.${quoteIdent(local)}
               and e_${f.embed}.${quoteIdent(f.column)} = ${expr})`
        );
        continue;
      }
      const cols = await this.rest.columns(this.table);
      const col = `${alias}.${quoteColumn(f.column || "id")}`;
      switch (f.kind) {
        case "eq": {
          if (f.value === null) {
            clauses.push(`${col} is null`);
          } else {
            const expr = this.rest.encodeValue(f.value, cols.get(f.column), params);
            clauses.push(`${col} = ${expr}`);
          }
          break;
        }
        case "is":
          clauses.push(`${col} is ${f.value === null ? "null" : String(f.value)}`);
          break;
        case "in": {
          const values = f.value as unknown[];
          if (values.length === 0) {
            clauses.push("false");
            break;
          }
          const exprs = values.map((v) =>
            this.rest.encodeValue(v, cols.get(f.column), params)
          );
          clauses.push(`${col} in (${exprs.join(", ")})`);
          break;
        }
        case "gt":
        case "lt":
        case "gte":
        case "lte": {
          const expr = this.rest.encodeValue(f.value, cols.get(f.column), params);
          const op = { gt: ">", lt: "<", gte: ">=", lte: "<=" }[f.kind];
          clauses.push(`${col} ${op} ${expr}`);
          break;
        }
        case "or": {
          const parts = String(f.value)
            .split(",")
            .map((segment) => {
              const m = segment.match(/^([a-z0-9_]+)\.(is|eq|lte|gte|ilike)\.(.*)$/);
              if (!m) {
                throw new Error(`postgrest-shim: unsupported or() segment ${segment}`);
              }
              const [, column, op, raw] = m;
              const target = `${alias}.${quoteIdent(column)}`;
              if (op === "is" && raw === "null") return `${target} is null`;
              const expr = this.rest.encodeValue(raw, cols.get(column), params);
              if (op === "ilike") return `${target} ilike ${expr}`;
              const sqlOp = op === "eq" ? "=" : op === "lte" ? "<=" : ">=";
              return `${target} ${sqlOp} ${expr}`;
            });
          clauses.push(`(${parts.join(" or ")})`);
          break;
        }
      }
    }
    return clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
  }

  private async embedExpr(
    parentTable: string,
    parentAlias: string,
    embed: EmbedSpec,
    params: unknown[],
    depth = 0
  ): Promise<string> {
    const fk = await this.rest.foreignKey(parentTable, embed.table);
    const embedAlias = `e${depth}_${embed.table}`;
    const parsed = parseSelect(embed.columns || "*");
    const selectParts = parsed.columns.map((c) =>
      c === "*" ? `${embedAlias}.*` : `${embedAlias}.${quoteIdent(c)}`
    );
    for (const sub of parsed.embeds) {
      selectParts.push(
        await this.embedExpr(embed.table, embedAlias, sub, params, depth + 1)
      );
    }
    // Dotted top-level filters targeting this embed constrain the embedded
    // rows too (PostgREST applies them to the embed).
    const extra: string[] = [];
    if (parentTable === this.table) {
      const embedCols = await this.rest.columns(embed.table);
      for (const f of this.filters) {
        if (f.embed !== embed.table) continue;
        const expr = this.rest.encodeValue(f.value, embedCols.get(f.column), params);
        extra.push(`and ${embedAlias}.${quoteIdent(f.column)} = ${expr}`);
      }
    }
    if (fk.fromTable === parentTable) {
      // many-to-one: parent.fk → embed.pk ⇒ a single object (or null).
      return `(select to_jsonb(x) from (
          select ${selectParts.join(", ")} from ${quoteIdent(embed.table)} ${embedAlias}
           where ${embedAlias}.${quoteIdent(fk.toColumn)} = ${parentAlias}.${quoteIdent(fk.fromColumn)}
           ${extra.join(" ")}
        ) x) as ${quoteIdent(embed.table)}`;
    }
    // one-to-many: embed.fk → parent.pk ⇒ an array (possibly empty).
    return `coalesce((select jsonb_agg(to_jsonb(x)) from (
        select ${selectParts.join(", ")} from ${quoteIdent(embed.table)} ${embedAlias}
         where ${embedAlias}.${quoteIdent(fk.fromColumn)} = ${parentAlias}.${quoteIdent(fk.toColumn)}
         ${extra.join(" ")}
      ) x), '[]'::jsonb) as ${quoteIdent(embed.table)}`;
  }

  private async execute(): Promise<{
    data: unknown;
    error: ShimError | null;
    count: number | null;
  }> {
    try {
      return await this.run();
    } catch (err) {
      if ((err as Error).message?.startsWith("postgrest-shim:")) throw err;
      return { data: null, error: toShimError(err), count: null };
    }
  }

  private finish(rawRows: Row[]): {
    data: unknown;
    error: ShimError | null;
    count: number | null;
  } {
    const rows = jsonify(rawRows);
    if (this.singleMode === "single") {
      if (rows.length !== 1) {
        return {
          data: null,
          error: new ShimError(
            "JSON object requested, multiple (or no) rows returned",
            "PGRST116",
            `Results contain ${rows.length} rows`
          ),
          count: null,
        };
      }
      return { data: rows[0], error: null, count: null };
    }
    if (this.singleMode === "maybeSingle") {
      if (rows.length > 1) {
        return {
          data: null,
          error: new ShimError(
            "JSON object requested, multiple (or no) rows returned",
            "PGRST116",
            `Results contain ${rows.length} rows`
          ),
          count: null,
        };
      }
      return { data: rows[0] ?? null, error: null, count: null };
    }
    return { data: rows, error: null, count: null };
  }

  private async run(): Promise<{
    data: unknown;
    error: ShimError | null;
    count: number | null;
  }> {
    const alias = "t";
    const table = `${quoteIdent(this.table)} ${alias}`;

    if (this.mode.op === "select") {
      const params: unknown[] = [];
      const where = await this.whereSql(params, alias);
      if (this.headMode && this.countMode) {
        const res = await this.pg.query<{ n: number }>(
          `select count(*)::int as n from ${table} ${where}`,
          params
        );
        return { data: null, error: null, count: res.rows[0]?.n ?? 0 };
      }
      const parsed = parseSelect(this.selectStr ?? "*");
      const selectParts: string[] = [];
      for (const col of parsed.columns) {
        selectParts.push(col === "*" ? `${alias}.*` : `${alias}.${quoteIdent(col)}`);
      }
      // !inner embeds behave as inner joins: require a matching row.
      const innerClauses: string[] = [];
      for (const embed of parsed.embeds) {
        selectParts.push(await this.embedExpr(this.table, alias, embed, params));
        if (embed.inner) {
          const fk = await this.rest.foreignKey(this.table, embed.table);
          const [local, remote] =
            fk.fromTable === this.table
              ? [fk.fromColumn, fk.toColumn]
              : [fk.toColumn, fk.fromColumn];
          const embedFilters = this.filters.filter((f) => f.embed === embed.table);
          const extra: string[] = [];
          const embedCols = await this.rest.columns(embed.table);
          for (const f of embedFilters) {
            const expr = this.rest.encodeValue(f.value, embedCols.get(f.column), params);
            extra.push(`and ie.${quoteIdent(f.column)} = ${expr}`);
          }
          innerClauses.push(
            `exists (select 1 from ${quoteIdent(embed.table)} ie
               where ie.${quoteIdent(remote)} = ${alias}.${quoteIdent(local)} ${extra.join(" ")})`
          );
        }
      }
      // Dotted filters already appear in whereSql as exists(); combine.
      let sql = `select ${selectParts.join(", ")} from ${table} ${where}`;
      if (innerClauses.length > 0) {
        sql += where ? ` and ${innerClauses.join(" and ")}` : ` where ${innerClauses.join(" and ")}`;
      }
      if (this.orders.length > 0) {
        sql += ` order by ${this.orders
          .map((o) => `${alias}.${quoteIdent(o.column)} ${o.ascending ? "asc" : "desc"}`)
          .join(", ")}`;
      }
      if (this.limitN !== null) sql += ` limit ${this.limitN}`;
      if (this.offsetN !== null) sql += ` offset ${this.offsetN}`;
      const res = await this.pg.query<Row>(sql, params);
      return this.finish(res.rows);
    }

    if (this.mode.op === "insert" || this.mode.op === "upsert") {
      const rowsIn = Array.isArray(this.mode.values)
        ? this.mode.values
        : [this.mode.values];
      if (rowsIn.length === 0) return this.finish([]);
      const cols = await this.rest.columns(this.table);
      const keys = [...new Set(rowsIn.flatMap((r) => Object.keys(r)))].filter(
        (k) => rowsIn.some((r) => r[k] !== undefined)
      );
      const params: unknown[] = [];
      const tuples = rowsIn.map(
        (row) =>
          `(${keys
            .map((k) =>
              row[k] === undefined
                ? "default"
                : this.rest.encodeValue(row[k], cols.get(k), params)
            )
            .join(", ")})`
      );
      let sql = `insert into ${quoteIdent(this.table)} (${keys
        .map(quoteIdent)
        .join(", ")}) values ${tuples.join(", ")}`;
      if (this.mode.op === "upsert") {
        const conflictCols = this.mode.onConflict.split(",").map((c) => c.trim());
        const updates = keys
          .filter((k) => !conflictCols.includes(k))
          .map((k) => `${quoteIdent(k)} = excluded.${quoteIdent(k)}`);
        sql += ` on conflict (${conflictCols.map(quoteIdent).join(", ")}) do update set ${updates.join(", ")}`;
      }
      if (this.selectStr !== null) sql += " returning *";
      const res = await this.pg.query<Row>(sql, params);
      if (this.selectStr === null) return { data: null, error: null, count: null };
      return this.finish(res.rows);
    }

    if (this.mode.op === "update") {
      const cols = await this.rest.columns(this.table);
      const params: unknown[] = [];
      const sets = Object.entries(this.mode.values)
        .filter(([, v]) => v !== undefined)
        .map(
          ([k, v]) => `${quoteIdent(k)} = ${this.rest.encodeValue(v, cols.get(k), params)}`
        );
      const where = await this.whereSql(params, alias);
      if (!where) throw new Error("postgrest-shim: update without filters");
      let sql = `update ${quoteIdent(this.table)} as ${alias} set ${sets.join(", ")} ${where}`;
      if (this.selectStr !== null) sql += " returning *";
      const res = await this.pg.query<Row>(sql, params);
      if (this.selectStr === null) return { data: null, error: null, count: null };
      return this.finish(res.rows);
    }

    // delete
    const params: unknown[] = [];
    const where = await this.whereSql(params, alias);
    if (!where) throw new Error("postgrest-shim: delete without filters");
    let sql = `delete from ${quoteIdent(this.table)} as ${alias} ${where}`;
    if (this.selectStr !== null) sql += " returning *";
    const res = await this.pg.query<Row>(sql, params);
    if (this.selectStr === null) return { data: null, error: null, count: null };
    return this.finish(res.rows);
  }
}

/**
 * A `SupabaseClient`-shaped object backed by PGlite. Only the surface
 * `createSupabaseDb` uses is real; the cast is the point of the shim.
 */
export function createPgliteSupabaseClient(
  pg: PGlite,
  user: ShimUser
): SupabaseClient {
  const rest = new PgliteRest(pg, user);
  return {
    from: (table: string) => rest.from(table),
    rpc: (fn: string, args?: Record<string, unknown>) => rest.rpc(fn, args),
    auth: rest.auth,
  } as unknown as SupabaseClient;
}
