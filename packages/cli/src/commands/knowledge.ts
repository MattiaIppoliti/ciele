import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

/**
 * `ciele collections|sources|faqs …` (#628). File inputs (`sources add-file`,
 * `faqs import`) read a local path and stream it as multipart — the server
 * does extraction/parsing exactly as it does for the admin app.
 */

const SOURCE_COLUMNS = [
  { key: "id", header: "Id" },
  { key: "name", header: "Name" },
  { key: "kind", header: "Kind" },
  { key: "status", header: "Status" },
  { key: "createdAt", header: "Created" },
];

const ORG_SOURCE_COLUMNS = [
  { key: "id", header: "Id" },
  { key: "name", header: "Name" },
  { key: "kind", header: "Kind" },
  { key: "status", header: "Status" },
  { key: "conceptCount", header: "Pages" },
  { key: "createdAt", header: "Created" },
];

const COLLECTION_COLUMNS = [
  { key: "id", header: "Id" },
  { key: "name", header: "Name" },
  { key: "description", header: "Description" },
];

function localFile(path: string, type?: string): File {
  const bytes = readFileSync(path);
  return new File([bytes], basename(path), type ? { type } : undefined);
}

export async function collections(
  verb: string | undefined,
  ctx: CommandContext
): Promise<number> {
  const { client, rest, emit, deps } = ctx;
  if (verb !== "list" || !rest[0]) {
    return usage(deps, "collections list <assistantId>");
  }
  const { data } = await client.knowledge.collections(rest[0]);
  emit(table(data, COLLECTION_COLUMNS), { data });
  return EXIT.ok;
}

export async function sources(
  verb: string | undefined,
  ctx: CommandContext
): Promise<number> {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      if (!rest[0]) return usage(deps, "sources list <collectionId>");
      const { data } = await client.knowledge.sources(rest[0]);
      emit(table(data, SOURCE_COLUMNS), { data });
      return EXIT.ok;
    }
    case "get": {
      if (!rest[0]) return usage(deps, "sources get <id>");
      const source = await client.knowledge.getSource(rest[0]);
      emit(table([source], SOURCE_COLUMNS), source);
      return EXIT.ok;
    }
    case "add-text": {
      const text = str(flags.text);
      const file = str(flags.file);
      if (!rest[0] || (!text && !file)) {
        return usage(
          deps,
          "sources add-text <collectionId> (--text <t> | --file <path>) [--name <n>]"
        );
      }
      const source = await client.knowledge.addTextSource(rest[0], {
        name: str(flags.name) ?? (file ? basename(file) : undefined),
        text: text ?? readFileSync(file!, "utf8"),
      });
      emit(`Created source ${source.id} (${source.status})`, source);
      return EXIT.ok;
    }
    case "add-url": {
      const url = str(flags.url) ?? rest[1];
      if (!rest[0] || !url) {
        return usage(deps, "sources add-url <collectionId> --url <url>");
      }
      const source = await client.knowledge.addUrlSource(rest[0], url);
      emit(`Created source ${source.id} (${source.status})`, source);
      return EXIT.ok;
    }
    case "add-file": {
      const file = str(flags.file);
      if (!rest[0] || !file) {
        return usage(deps, "sources add-file <collectionId> --file <path>");
      }
      const source = await client.knowledge.addFileSource(rest[0], localFile(file));
      emit(`Created source ${source.id} (${source.status})`, source);
      return EXIT.ok;
    }
    case "delete": {
      if (!rest[0]) return usage(deps, "sources delete <id> --yes");
      if (flags.yes !== true) {
        deps.stderr("Deleting a source removes its Concepts. Re-run with --yes.");
        return EXIT.usage;
      }
      await client.knowledge.deleteSource(rest[0]);
      emit(`Deleted source ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    }
    case "recrawl": {
      if (!rest[0]) return usage(deps, "sources recrawl <id>");
      await client.knowledge.recrawlSource(rest[0]);
      emit(`Re-crawl started for ${rest[0]} — poll with: ciele sources get ${rest[0]}`, {
        ok: true,
      });
      return EXIT.ok;
    }
    case "list-org": {
      const kinds = str(flags.kinds);
      const { items, total } = await client.knowledge.orgSources({
        kinds: kinds ? kinds.split(",") : undefined,
        status: str(flags.status),
        assistantId: str(flags.assistant),
        q: str(flags.q),
        page: flags.page ? Number(flags.page) : undefined,
        pageSize: flags.pageSize ? Number(flags.pageSize) : undefined,
      });
      emit(table(items, ORG_SOURCE_COLUMNS), { items, total });
      return EXIT.ok;
    }
    case "link": {
      const assistants = str(flags.assistants);
      if (!rest[0] || assistants === undefined) {
        return usage(
          deps,
          "sources link <id> --assistants <a,b,…>   (empty list unlinks all)"
        );
      }
      const { links } = await client.knowledge.setSourceLinks(
        rest[0],
        assistants ? assistants.split(",") : []
      );
      emit(
        `Linked to ${links.length} assistant${links.length === 1 ? "" : "s"}`,
        { links }
      );
      return EXIT.ok;
    }
    case "direct-access": {
      const assistant = str(flags.assistant);
      const state = rest[1];
      if (!rest[0] || !assistant || (state !== "on" && state !== "off")) {
        return usage(
          deps,
          "sources direct-access <id> <on|off> --assistant <assistantId>"
        );
      }
      const { links } = await client.knowledge.setDirectAccess(
        rest[0],
        assistant,
        state === "on"
      );
      emit(`Direct access ${state} for ${assistant}`, { links });
      return EXIT.ok;
    }
    default:
      return usage(
        deps,
        "sources <list|list-org|get|add-text|add-url|add-file|link|direct-access|delete|recrawl>"
      );
  }
}

export async function faqs(
  verb: string | undefined,
  ctx: CommandContext
): Promise<number> {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "add": {
      const question = str(flags.question);
      const answer = str(flags.answer);
      if (!rest[0] || !question || !answer) {
        return usage(deps, "faqs add <collectionId> --question <q> --answer <a>");
      }
      const faq = await client.knowledge.addFaq(rest[0], { question, answer });
      emit(`Created FAQ ${faq.id} ("${faq.question}")`, faq);
      return EXIT.ok;
    }
    case "import": {
      const file = str(flags.file);
      if (!rest[0] || !file) {
        return usage(deps, "faqs import <collectionId> --file <faqs.csv>");
      }
      const result = await client.knowledge.importFaqs(
        rest[0],
        localFile(file, "text/csv")
      );
      const skipped =
        result.skipped.length > 0 ? `, skipped: ${result.skipped.join("; ")}` : "";
      emit(`Imported ${result.imported} FAQs${skipped}`, result);
      return EXIT.ok;
    }
    case "add-org": {
      const question = str(flags.question);
      const answer = str(flags.answer);
      const assistants = str(flags.assistants);
      if (!question || !answer || !assistants) {
        return usage(
          deps,
          "faqs add-org --question <q> --answer <a> --assistants <a,b,…>"
        );
      }
      const faq = await client.knowledge.addOrgFaq({
        question,
        answer,
        assistantIds: assistants.split(","),
      });
      emit(`Created FAQ ${faq.id} ("${faq.question}")`, faq);
      return EXIT.ok;
    }
    case "import-org": {
      const file = str(flags.file);
      const assistants = str(flags.assistants);
      if (!file || !assistants) {
        return usage(
          deps,
          "faqs import-org --file <faqs.csv> --assistants <a,b,…>"
        );
      }
      const result = await client.knowledge.importOrgFaqs(
        localFile(file, "text/csv"),
        assistants.split(",")
      );
      const skipped =
        result.skipped.length > 0 ? `, skipped: ${result.skipped.join("; ")}` : "";
      emit(`Imported ${result.imported} FAQs${skipped}`, result);
      return EXIT.ok;
    }
    case "export": {
      const csv = await client.knowledge.exportOrgFaqs();
      emit(csv, { csv });
      return EXIT.ok;
    }
    default:
      return usage(deps, "faqs <add|add-org|import|import-org|export>");
  }
}
