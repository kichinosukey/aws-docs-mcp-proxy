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
    else if (arg === "--clients") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--") || value.trim() === "") {
        console.error("error: --clients requires a comma-separated client list");
        process.exit(1);
      }
      opts.clients = value.split(",").map((s) => s.trim());
    }
  }
  return opts;
}

function formatClientList(clients) {
  return clients.length > 0 ? clients.join(", ") : "(none)";
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

  const updated = results.filter((r) => r.status === "updated" || r.status === "dry-run").map((r) => r.client);
  const skipped = results.filter((r) => r.status === "skipped").map((r) => r.client);
  const failed = results.filter((r) => r.status === "failed").map((r) => r.client);

  console.log("");
  console.log("Done. Restart your MCP clients to load aws_docs.");
  console.log(`Updated: ${formatClientList(updated)}`);
  console.log(`Skipped: ${formatClientList(skipped)}`);
  console.log(`Failed: ${formatClientList(failed)}`);

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
