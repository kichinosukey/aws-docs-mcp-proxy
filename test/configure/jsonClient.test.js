import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { mergeAwsDocsJson, hasAwsDocs, readJsonFile } from "../../scripts/lib/jsonClient.js";

test("hasAwsDocs detects existing entry", async () => {
  const file = path.join(import.meta.dirname, "../fixtures/configure/cursor-existing.json");
  const data = await readJsonFile(file);
  assert.equal(hasAwsDocs(data), true);
});

test("mergeAwsDocsJson adds aws_docs without removing other servers", () => {
  const input = { mcpServers: { other: { command: "npx" } } };
  const output = mergeAwsDocsJson(input, "/new/bin/aws-docs-mcp-proxy");
  assert.deepEqual(output, {
    mcpServers: {
      other: { command: "npx" },
      aws_docs: { command: "/new/bin/aws-docs-mcp-proxy" }
    }
  });
});

test("mergeAwsDocsJson updates only command on existing aws_docs", () => {
  const input = { mcpServers: { aws_docs: { command: "/old", args: ["x"] } } };
  const output = mergeAwsDocsJson(input, "/new/bin/aws-docs-mcp-proxy");
  assert.equal(output.mcpServers.aws_docs.command, "/new/bin/aws-docs-mcp-proxy");
  assert.deepEqual(output.mcpServers.aws_docs.args, ["x"]);
});

test("writeJsonWithBackup creates backup file", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cfg-"));
  const file = path.join(tmp, "mcp.json");
  await fs.writeFile(file, '{"mcpServers":{}}\n');
  const { writeJsonWithBackup } = await import("../../scripts/lib/jsonClient.js");
  await writeJsonWithBackup(file, { mcpServers: { aws_docs: { command: "/x" } } });
  const backups = (await fs.readdir(tmp)).filter((n) => n.includes(".bak."));
  assert.equal(backups.length, 1);
});
