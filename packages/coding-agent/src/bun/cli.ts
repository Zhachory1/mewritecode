#!/usr/bin/env node
process.title = "mewrite-code";
process.emitWarning = (() => {}) as typeof process.emitWarning;

await import("./register-bedrock.js");
await import("../cli.js");
