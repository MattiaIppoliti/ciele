#!/usr/bin/env node
// Runs the TypeScript sources via Node's type stripping (>=22.6; unflagged
// from 23.6), same arrangement as the ciele CLI; packaging lands with #630.
const { main } = await import("../src/index.ts");
await main();
