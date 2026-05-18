#!/usr/bin/env node
process.title = "caveman-code";
process.emitWarning = (() => {}) as typeof process.emitWarning;

await import("./register-bedrock.js");
await import("../cli.js");
