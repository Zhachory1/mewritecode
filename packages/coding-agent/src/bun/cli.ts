#!/usr/bin/env node
process.emitWarning = (() => {}) as typeof process.emitWarning;

const { APP_NAME } = await import("../config.js");
process.title = APP_NAME;

await import("./register-bedrock.js");
await import("../cli.js");
