#!/usr/bin/env node
// Runs the TypeScript CLI directly via Node's type stripping (>=22.6 with
// --experimental-strip-types, unflagged from 23.6). A build step arrives
// with the packaging slice (#630) if publishing needs older Nodes.
import process from "node:process";

const { main } = await import("../src/index.ts");
process.exitCode = await main(process.argv.slice(2));
