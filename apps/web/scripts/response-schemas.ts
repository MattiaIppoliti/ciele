import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

type Schema = Record<string, unknown>;

const API_ROOT = resolve(__dirname, '../src/app/api/v1');
const WEB_ROOT = resolve(__dirname, '..');

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === 'route.ts' ? [path] : [];
  });
}

function routePath(file: string): string {
  const folder = relative(API_ROOT, resolve(file, '..'));
  return `/${folder.split(sep).map((segment) => segment.replace(/^\[(\w+)\]$/, '{$1}')).join('/')}`;
}

/** Convert the type passed to Response.json into a bounded JSON Schema. */
function responseSchema(type: ts.Type, checker: ts.TypeChecker, at: ts.Node, depth = 0, seen = new Set<ts.Type>()): Schema {
  if (depth > 5 || (seen.has(type))) return {};
  const flags = type.flags;
  if (flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown) return {};
  if (flags & ts.TypeFlags.StringLiteral) return { type: 'string', const: (type as ts.StringLiteralType).value };
  if (flags & ts.TypeFlags.NumberLiteral) return { type: 'number', const: (type as ts.NumberLiteralType).value };
  if (flags & ts.TypeFlags.BooleanLiteral) return { type: 'boolean', const: checker.typeToString(type) === 'true' };
  if (flags & ts.TypeFlags.StringLike) return { type: 'string' };
  if (flags & ts.TypeFlags.NumberLike) return { type: 'number' };
  if (flags & ts.TypeFlags.BooleanLike) return { type: 'boolean' };
  if (flags & ts.TypeFlags.Null) return { type: 'null' };
  if (flags & ts.TypeFlags.Undefined || flags & ts.TypeFlags.Void) return {};
  if (type.isUnion()) {
    const variants = type.types.filter((item) => !(item.flags & ts.TypeFlags.Undefined));
    if (variants.length === 1) return responseSchema(variants[0], checker, at, depth, seen);
    return { oneOf: variants.map((item) => responseSchema(item, checker, at, depth + 1, new Set(seen))) };
  }
  if (type.isIntersection()) {
    return { allOf: type.types.map((item) => responseSchema(item, checker, at, depth + 1, new Set(seen))) };
  }
  if (checker.typeToString(type) === 'Date') return { type: 'string', format: 'date-time' };
  if (checker.isArrayType(type)) {
    const item = checker.getTypeArguments(type as ts.TypeReference)[0];
    return { type: 'array', items: item ? responseSchema(item, checker, at, depth + 1, new Set(seen)) : {} };
  }
  if (checker.isTupleType(type)) {
    const items = checker.getTypeArguments(type as ts.TypeReference)
      .map((item) => responseSchema(item, checker, at, depth + 1, new Set(seen)));
    return { type: 'array', prefixItems: items };
  }
  if (!(flags & ts.TypeFlags.Object)) return {};

  const nextSeen = new Set(seen);
  nextSeen.add(type);
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const symbol of checker.getPropertiesOfType(type).slice(0, 80)) {
    if (symbol.name.startsWith('__')) continue;
    const propertyType = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? at);
    if (propertyType.getCallSignatures().length > 0) continue;
    properties[symbol.name] = responseSchema(propertyType, checker, at, depth + 1, nextSeen);
    if (!(symbol.flags & ts.SymbolFlags.Optional)) required.push(symbol.name);
  }
  const schema: Schema = { type: 'object' };
  if (Object.keys(properties).length) schema.properties = properties;
  if (required.length) schema.required = required;
  const indexType = checker.getIndexTypeOfType(type, ts.IndexKind.String);
  if (indexType) schema.additionalProperties = responseSchema(indexType, checker, at, depth + 1, nextSeen);
  else if (!Object.keys(properties).length) schema.additionalProperties = true;
  return schema;
}

export function deriveResponseSchemas(): Record<string, Schema> {
  const config = ts.readConfigFile(join(WEB_ROOT, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, WEB_ROOT);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const result: Record<string, Schema> = {};

  for (const file of routeFiles(API_ROOT).sort()) {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`Missing TypeScript source: ${file}`);
    for (const statement of source.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
      const method = statement.name.text.toLowerCase();
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const schemas: Schema[] = [];
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && node.expression.expression.getText(source) === 'Response'
          && node.expression.name.text === 'json'
          && node.arguments[0]) {
          schemas.push(responseSchema(checker.getTypeAtLocation(node.arguments[0]), checker, node.arguments[0]));
        }
        ts.forEachChild(node, visit);
      }
      visit(statement.body ?? statement);
      if (schemas.length) {
        const key = `${method} ${routePath(file)}`;
        result[key] = schemas.length === 1 ? schemas[0] : { oneOf: schemas };
      }
    }
  }
  return result;
}
