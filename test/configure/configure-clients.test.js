import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", reject);
  });
}

test("configure-clients dry-run updates fixture cursor config", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-cfg-"));
  const home = path.join(tmp, "home");
  const cursorDir = path.join(home, ".cursor");
  await fs.mkdir(cursorDir, { recursive: true });
  const fixture = path.join(import.meta.dirname, "../fixtures/configure/cursor-empty.json");
  const target = path.join(cursorDir, "mcp.json");
  await fs.copyFile(fixture, target);

  const script = path.join(import.meta.dirname, "../../scripts/configure-clients.js");
  const { code, stdout } = await runNode([script, "--dry-run", "--yes", "--clients", "cursor"], {
    HOME: home,
    AWS_DOCS_COMMAND: "/tmp/aws-docs-mcp-proxy"
  });

  assert.equal(code, 0);
  assert.match(stdout, /cursor: dry-run/);
  const unchanged = await fs.readFile(target, "utf8");
  assert.doesNotMatch(unchanged, /aws_docs/);
});
