import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { installPaths, commandPath } from "../../scripts/lib/paths.js";

test("commandPath returns absolute bin path under homedir", () => {
  const cmd = commandPath();
  assert.match(cmd, new RegExp(`^${os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.local/bin/aws-docs-mcp-proxy$`));
});

test("installPaths returns versioned layout", () => {
  const paths = installPaths("0.2.0");
  assert.equal(paths.versionDir, path.join(os.homedir(), ".local/share/aws-docs-mcp-proxy/0.2.0"));
  assert.equal(paths.currentLink, path.join(os.homedir(), ".local/share/aws-docs-mcp-proxy/current"));
  assert.equal(paths.binLink, path.join(os.homedir(), ".local/bin/aws-docs-mcp-proxy"));
});
