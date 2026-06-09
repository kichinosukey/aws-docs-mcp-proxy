#!/usr/bin/env node
import { commandPath } from "./lib/paths.js";
import * as cursor from "./lib/cursor.js";
import * as claude from "./lib/claude.js";
import * as codex from "./lib/codex.js";

const CLIENTS = { cursor, claude, codex };

function parseArgs(argv) {
  const opts = { dryRun: false, assumeYes: false, clients: Object.keys(CLIENTS) };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--yes") opts.assumeYes = true;
    else if (arg === "--clients") opts.clients = argv[++i].split(",").map((s) => s.trim());
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const command = process.env.AWS_DOCS_COMMAND ?? commandPath();
  const results = [];

  for (const clientName of opts.clients) {
    const client = CLIENTS[clientName];
    if (!client) {
      results.push({ client: clientName, status: "failed", reason: "unknown client" });
      continue;
    }
    const result = await client.configure({
      command,
      dryRun: opts.dryRun,
      assumeYes: opts.assumeYes
    });
    results.push({ client: clientName, ...result });
    console.log(`${clientName}: ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
  }

  const failed = results.filter((r) => r.status === "failed");
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
