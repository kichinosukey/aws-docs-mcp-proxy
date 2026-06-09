import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { hasAwsDocsToml, upsertAwsDocsCommand } from "../../scripts/lib/codex.js";

test("hasAwsDocsToml detects section", async () => {
  const file = path.join(import.meta.dirname, "../fixtures/configure/codex-existing.toml");
  const text = await fs.readFile(file, "utf8");
  assert.equal(hasAwsDocsToml(text), true);
});

test("upsertAwsDocsCommand updates command and preserves tool tables", async () => {
  const file = path.join(import.meta.dirname, "../fixtures/configure/codex-existing.toml");
  const text = await fs.readFile(file, "utf8");
  const next = upsertAwsDocsCommand(text, "/new/bin/aws-docs-mcp-proxy");
  assert.match(next, /\[mcp_servers\.aws_docs\]\ncommand = "\/new\/bin\/aws-docs-mcp-proxy"/);
  assert.match(next, /\[mcp_servers\.aws_docs\.tools\.aws_docs_search\]/);
  assert.match(next, /approval_mode = "approve"/);
});

test("upsertAwsDocsCommand appends new section when missing", async () => {
  const file = path.join(import.meta.dirname, "../fixtures/configure/codex-empty.toml");
  const text = await fs.readFile(file, "utf8");
  const next = upsertAwsDocsCommand(text, "/new/bin/aws-docs-mcp-proxy");
  assert.match(next, /\[mcp_servers\.aws_docs\]\ncommand = "\/new\/bin\/aws-docs-mcp-proxy"/);
  assert.match(next, /\[mcp_servers\.other\]/);
});
