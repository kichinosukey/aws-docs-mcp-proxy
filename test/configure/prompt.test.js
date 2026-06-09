import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { confirmOverwrite, isInteractive } from "../../scripts/lib/prompt.js";

test("confirmOverwrite returns true when assumeYes", async () => {
  assert.equal(await confirmOverwrite("overwrite?", { assumeYes: true }), true);
});

test("confirmOverwrite declines when stdin is not a TTY", async () => {
  const lib = path.join(import.meta.dirname, "../../scripts/lib/prompt.js");
  const code = `import { confirmOverwrite } from ${JSON.stringify(lib)}; const ok = await confirmOverwrite("overwrite?"); console.log(ok ? "yes" : "no");`;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.on("error", reject);
    child.stdin.end();
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "no");
  assert.match(result.stderr, /non-interactive install/);
  assert.match(result.stderr, /bash -s -- --yes/);
});

test("isInteractive reflects stdin TTY in current process", () => {
  assert.equal(typeof isInteractive(), "boolean");
});
