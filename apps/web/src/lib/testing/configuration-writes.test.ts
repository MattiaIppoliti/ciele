import { readFileSync,readdirSync } from "node:fs";
import { join,relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect,it } from "vitest";
import { configurationWrites,CONFIGURATION_WRITE_EXCEPTIONS } from "./configuration-writes";
const root=fileURLToPath(new URL("../../",import.meta.url));
function files(dir: string): string[] { return readdirSync(dir,{withFileTypes:true}).flatMap(entry => entry.isDirectory() ? files(join(dir,entry.name)) : entry.name.endsWith(".ts") && !entry.name.includes(".test.") ? [join(dir,entry.name)] : []); }
it("requires every direct Db write on a server action or route to be audited or individually explained", () => {
  const writes=files(root).flatMap(file => configurationWrites(relative(root,file),readFileSync(file,"utf8")));
  expect(writes.filter(row => !row.audited && !row.exception)).toEqual([]);
  expect(Object.keys(CONFIGURATION_WRITE_EXCEPTIONS).filter(key => !writes.some(row => row.key===key))).toEqual([]);
});
it("detects new direct methods and table mutations while recognizing named audited callbacks", () => {
  const text='"use server"; export async function change() { await db.updateAssistant(id,patch); await ctx.db.table("settings").update(id,patch); }';
  expect(configurationWrites("app/probe.ts",text).map(row => row.audited)).toEqual([false,false]);
  expect(configurationWrites("app/probe.ts", '"use server"; async function change() { const store = await getDb(); await store.updateAssistant(id, patch); }').map(row => row.audited)).toEqual([false]);
  expect(configurationWrites("app/probe.ts",'"use server"; export async function change() { return orgMutation({ operation:{ name:"settings.update",effect:"write" } },async ({db}) => db.updateAssistant(id,patch)); }').map(row => row.audited)).toEqual([true]);
});
