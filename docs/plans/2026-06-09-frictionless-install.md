# Frictionless Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a one-command GitHub Releases installer that places `aws-docs-mcp-proxy` under `~/.local/` and auto-configures Cursor, Codex, and Claude Code global MCP settings.

**Architecture:** Thin `install.sh` downloads a release tarball, creates versioned install + symlinks, then runs `configure-clients.js`. Configure logic is split into per-client modules (`cursor`, `claude`, `codex`) with shared path/prompt helpers. Codex TOML updates are zero-dependency: regex-based `command` line upsert inside `[mcp_servers.aws_docs]` without touching nested tool tables.

**Tech Stack:** Node.js 20+ (built-in test runner, readline, fs), bash, curl, tar, GitHub Actions, GitHub Releases API

**Spec:** `docs/specs/2026-06-09-frictionless-install-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `scripts/lib/paths.js` | Install dir constants, `commandPath()` resolver |
| `scripts/lib/prompt.js` | Interactive y/N prompts, `--yes` bypass |
| `scripts/lib/jsonClient.js` | Shared JSON read/merge/backup for Cursor + Claude |
| `scripts/lib/cursor.js` | `~/.cursor/mcp.json` adapter |
| `scripts/lib/claude.js` | `~/.claude.json` adapter |
| `scripts/lib/codex.js` | `~/.codex/config.toml` TOML upsert |
| `scripts/configure-clients.js` | CLI entry: parse flags, orchestrate clients, print report |
| `scripts/install.sh` | Download, extract, symlink, invoke configure |
| `scripts/build-release-tarball.sh` | CI/local helper to produce tarball contents |
| `.github/workflows/release.yml` | Tag → tarball + install.sh on Release |
| `test/configure/paths.test.js` | Unit tests for paths |
| `test/configure/jsonClient.test.js` | JSON merge + backup tests |
| `test/configure/codex.test.js` | TOML upsert tests |
| `test/configure/configure-clients.test.js` | Integration with fixture dirs |
| `test/fixtures/configure/` | Sample client config files |
| `README.md` | New Quick start + Advanced section |

---

### Task 1: Path helpers

**Files:**
- Create: `scripts/lib/paths.js`
- Test: `test/configure/paths.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/configure/paths.test.js`  
Expected: FAIL `Cannot find module`

- [ ] **Step 3: Write minimal implementation**

```js
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const SHARE_ROOT = path.join(HOME, ".local/share/aws-docs-mcp-proxy");

export function commandPath() {
  return path.join(HOME, ".local/bin/aws-docs-mcp-proxy");
}

export function installPaths(version) {
  return {
    shareRoot: SHARE_ROOT,
    versionDir: path.join(SHARE_ROOT, version),
    currentLink: path.join(SHARE_ROOT, "current"),
    binLink: commandPath(),
    binTarget: path.join(SHARE_ROOT, "current/bin/aws-docs-mcp-proxy.js")
  };
}

export const CLIENT_CONFIGS = {
  cursor: path.join(HOME, ".cursor/mcp.json"),
  claude: path.join(HOME, ".claude.json"),
  codex: path.join(HOME, ".codex/config.toml")
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/configure/paths.test.js`  
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/paths.js test/configure/paths.test.js
git commit -m "feat(install): add path helpers for local install layout"
```

---

### Task 2: JSON client merge (Cursor + Claude)

**Files:**
- Create: `scripts/lib/prompt.js`
- Create: `scripts/lib/jsonClient.js`
- Create: `test/fixtures/configure/cursor-empty.json`
- Create: `test/fixtures/configure/cursor-existing.json`
- Test: `test/configure/jsonClient.test.js`

Fixture `cursor-empty.json`:
```json
{ "mcpServers": { "other": { "command": "npx", "args": ["other-mcp"] } } }
```

Fixture `cursor-existing.json`:
```json
{ "mcpServers": { "aws_docs": { "command": "/old/path" }, "other": { "command": "npx" } } }
```

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/configure/jsonClient.test.js`  
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

`scripts/lib/prompt.js`:
```js
import readline from "node:readline";

export async function confirmOverwrite(message, { assumeYes = false } = {}) {
  if (assumeYes) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) => {
    rl.question(`${message} [y/N] `, resolve);
  });
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}
```

`scripts/lib/jsonClient.js`:
```js
import fs from "node:fs/promises";
import path from "node:path";

export async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

export function hasAwsDocs(data) {
  return Boolean(data?.mcpServers?.aws_docs);
}

export function mergeAwsDocsJson(data, command) {
  const next = structuredClone(data ?? {});
  if (!next.mcpServers) next.mcpServers = {};
  const existing = next.mcpServers.aws_docs ?? {};
  next.mcpServers.aws_docs = { ...existing, command };
  return next;
}

export async function writeJsonWithBackup(filePath, data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${filePath}.bak.${stamp}`;
  await fs.copyFile(filePath, backup);
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return backup;
}

export async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/configure/jsonClient.test.js`  
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/prompt.js scripts/lib/jsonClient.js test/configure/jsonClient.test.js test/fixtures/configure/
git commit -m "feat(install): add JSON merge helpers for MCP client config"
```

---

### Task 3: Codex TOML upsert

**Files:**
- Create: `scripts/lib/codex.js`
- Create: `test/fixtures/configure/codex-empty.toml`
- Create: `test/fixtures/configure/codex-existing.toml`
- Test: `test/configure/codex.test.js`

Fixture `codex-empty.toml`:
```toml
[mcp_servers.other]
command = "npx"
args = ["other-mcp"]
```

Fixture `codex-existing.toml`:
```toml
[mcp_servers.aws_docs]
command = "/old/path"

[mcp_servers.aws_docs.tools.aws_docs_search]
approval_mode = "approve"

[mcp_servers.other]
command = "npx"
```

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/configure/codex.test.js`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`scripts/lib/codex.js`:
```js
const AWS_DOCS_HEADER = "[mcp_servers.aws_docs]";

export function hasAwsDocsToml(text) {
  return text.includes(AWS_DOCS_HEADER);
}

function escapeTomlString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function upsertAwsDocsCommand(text, command) {
  const escaped = escapeTomlString(command);
  const commandLine = `command = "${escaped}"`;

  if (!hasAwsDocsToml(text)) {
    const suffix = text.endsWith("\n") ? "" : "\n";
    return `${text}${suffix}\n${AWS_DOCS_HEADER}\n${commandLine}\n`;
  }

  const lines = text.split("\n");
  const headerIndex = lines.findIndex((line) => line.trim() === AWS_DOCS_HEADER);
  if (headerIndex === -1) {
    throw new Error("aws_docs header found but not on its own line");
  }

  let endIndex = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("[") && !line.startsWith("[mcp_servers.aws_docs.")) {
      endIndex = i;
      break;
    }
  }

  const block = lines.slice(headerIndex + 1, endIndex);
  const commandIdx = block.findIndex((line) => line.trim().startsWith("command"));
  if (commandIdx === -1) {
    block.unshift(commandLine);
  } else {
    block[commandIdx] = commandLine;
  }

  const rebuilt = [
    ...lines.slice(0, headerIndex + 1),
    ...block,
    ...lines.slice(endIndex)
  ];
  return `${rebuilt.join("\n").replace(/\n*$/, "\n")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/configure/codex.test.js`  
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/codex.js test/configure/codex.test.js test/fixtures/configure/codex-*.toml
git commit -m "feat(install): add Codex TOML upsert for aws_docs command"
```

---

### Task 4: Per-client adapters

**Files:**
- Create: `scripts/lib/cursor.js`
- Create: `scripts/lib/claude.js`

- [ ] **Step 1: Implement cursor.js**

```js
import fs from "node:fs/promises";
import { CLIENT_CONFIGS } from "./paths.js";
import { hasAwsDocs, mergeAwsDocsJson, readJsonFile, writeJsonWithBackup, ensureParentDir } from "./jsonClient.js";
import { confirmOverwrite } from "./prompt.js";

export const name = "cursor";
export const configPath = CLIENT_CONFIGS.cursor;

export async function configure({ command, dryRun, assumeYes }) {
  const exists = await fs.access(configPath).then(() => true, () => false);
  if (!exists) {
    return { status: "skipped", reason: "config not found" };
  }

  let data;
  try {
    data = await readJsonFile(configPath);
  } catch (error) {
    return { status: "failed", reason: `invalid JSON: ${error.message}` };
  }

  if (hasAwsDocs(data)) {
    const ok = await confirmOverwrite(`${name}: aws_docs is already configured. Overwrite?`, { assumeYes });
    if (!ok) return { status: "skipped", reason: "user declined overwrite" };
  }

  const next = mergeAwsDocsJson(data, command);
  if (dryRun) {
    return { status: "dry-run", configPath, next };
  }

  if (hasAwsDocs(data)) {
    await writeJsonWithBackup(configPath, next);
  } else {
    await ensureParentDir(configPath);
    await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }

  return { status: "updated", configPath };
}
```

- [ ] **Step 2: Implement claude.js** (same pattern, `name = "claude"`, `configPath = CLIENT_CONFIGS.claude`)

- [ ] **Step 3: Extend codex.js with configure export**

Add to `scripts/lib/codex.js`:
```js
import fs from "node:fs/promises";
import path from "node:path";
import { CLIENT_CONFIGS } from "./paths.js";
import { confirmOverwrite } from "./prompt.js";

export const name = "codex";
export const configPath = CLIENT_CONFIGS.codex;

export async function configure({ command, dryRun, assumeYes }) {
  const exists = await fs.access(configPath).then(() => true, () => false);
  if (!exists) {
    return { status: "skipped", reason: "config not found" };
  }

  let text;
  try {
    text = await fs.readFile(configPath, "utf8");
  } catch (error) {
    return { status: "failed", reason: error.message };
  }

  if (hasAwsDocsToml(text)) {
    const ok = await confirmOverwrite(`${name}: aws_docs is already configured. Overwrite?`, { assumeYes });
    if (!ok) return { status: "skipped", reason: "user declined overwrite" };
  }

  const next = upsertAwsDocsCommand(text, command);
  if (dryRun) {
    return { status: "dry-run", configPath, next };
  }

  if (hasAwsDocsToml(text)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.copyFile(configPath, `${configPath}.bak.${stamp}`);
  } else {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
  }

  await fs.writeFile(configPath, next, "utf8");
  return { status: "updated", configPath };
}
```

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/cursor.js scripts/lib/claude.js scripts/lib/codex.js
git commit -m "feat(install): add per-client configure adapters"
```

---

### Task 5: configure-clients.js CLI + integration tests

**Files:**
- Create: `scripts/configure-clients.js`
- Test: `test/configure/configure-clients.test.js`

- [ ] **Step 1: Write integration test**

```js
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
```

Note: `configure-clients.js` must honor `HOME` override for tests and `AWS_DOCS_COMMAND` env for command path injection in tests.

- [ ] **Step 2: Implement configure-clients.js**

```js
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
```

Update `scripts/lib/paths.js` to use `process.env.HOME ?? os.homedir()` so tests can override `HOME`.

- [ ] **Step 3: Run tests**

Run: `node --test test/configure/`  
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/configure-clients.js scripts/lib/paths.js test/configure/configure-clients.test.js
git commit -m "feat(install): add configure-clients CLI with dry-run support"
```

---

### Task 6: install.sh

**Files:**
- Create: `scripts/install.sh`
- Create: `scripts/build-release-tarball.sh`

- [ ] **Step 1: Write build-release-tarball.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(node -p "require('$ROOT/package.json').version")}"
STAGE="$ROOT/.release/aws-docs-mcp-proxy-$VERSION"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$ROOT/bin" "$ROOT/src" "$ROOT/package.json" "$ROOT/LICENSE" "$STAGE/"
echo "$VERSION" > "$STAGE/VERSION"
tar -czf "$ROOT/.release/aws-docs-mcp-proxy-$VERSION.tar.gz" -C "$ROOT/.release" "aws-docs-mcp-proxy-$VERSION"
echo "Created $ROOT/.release/aws-docs-mcp-proxy-$VERSION.tar.gz"
```

- [ ] **Step 2: Write install.sh**

Key behaviors:
- `set -euo pipefail`
- Parse `--dry-run`, `--yes`, `--clients`
- Require `node` >= 20, `curl`, `tar`
- `REPO=kichinosukey/aws-docs-mcp-proxy`
- If `AWS_DOCS_INSTALL_SOURCE=local`, use local repo (for dev); else fetch latest release JSON
- Download `aws-docs-mcp-proxy-<version>.tar.gz`
- Extract to `~/.local/share/aws-docs-mcp-proxy/<version>/`
- `ln -sfn` version dir → `current`
- `mkdir -p ~/.local/bin && ln -sfn ../share/aws-docs-mcp-proxy/current/bin/aws-docs-mcp-proxy.js ~/.local/bin/aws-docs-mcp-proxy`
- Run `node "$INSTALL_ROOT/current/scripts/configure-clients.js" "$@"` forwarding flags
- Warn if `~/.local/bin` not in `PATH`

Include `scripts/` in release tarball (update `build-release-tarball.sh` to copy `scripts/install.sh` is NOT in tarball — install.sh is separate release asset; tarball must include `scripts/configure-clients.js` and `scripts/lib/`).

Updated `build-release-tarball.sh` copy line:
```bash
cp -R "$ROOT/bin" "$ROOT/src" "$ROOT/scripts" "$ROOT/package.json" "$ROOT/LICENSE" "$STAGE/"
```

- [ ] **Step 3: Local smoke**

```bash
chmod +x scripts/install.sh scripts/build-release-tarball.sh
bash scripts/build-release-tarball.sh 0.2.0
AWS_DOCS_INSTALL_SOURCE=local INSTALL_TARBALL=.release/aws-docs-mcp-proxy-0.2.0.tar.gz bash scripts/install.sh --dry-run --yes --clients cursor
```

Expected: dry-run output without writing real `~/.cursor/mcp.json` (use `HOME=/tmp/fake-home` for safety).

- [ ] **Step 4: Commit**

```bash
git add scripts/install.sh scripts/build-release-tarball.sh
git commit -m "feat(install): add install.sh and release tarball builder"
```

---

### Task 7: GitHub Release workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `package.json` (bump version to `0.2.0`)

- [ ] **Step 1: Add workflow**

```yaml
name: Release
on:
  push:
    tags: ["v*"]
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Build tarball
        run: |
          chmod +x scripts/build-release-tarball.sh
          VERSION="${GITHUB_REF_NAME#v}"
          bash scripts/build-release-tarball.sh "$VERSION"
      - name: Run tests
        run: npm test
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            .release/aws-docs-mcp-proxy-*.tar.gz
            scripts/install.sh
```

- [ ] **Step 2: Bump version**

In `package.json`, set `"version": "0.2.0"`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml package.json
git commit -m "chore(release): add GitHub Actions workflow for tagged releases"
```

---

### Task 8: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace Quick start section**

```markdown
## Quick start

Prerequisites: Node.js 20+, `aws login`, macOS or Linux.

```sh
curl -fsSL https://github.com/kichinosukey/aws-docs-mcp-proxy/releases/latest/download/install.sh | bash
```

Restart your MCP client (Cursor, Codex, or Claude Code). The installer configures global `aws_docs` automatically.

## Advanced / Manual setup

<details>
<summary>git clone and manual mcp.json configuration</summary>

...existing clone instructions...
</details>
```

- [ ] **Step 2: Add Troubleshooting rows**

| `install.sh` fails on Node version | Install Node.js 20+ |
| Installer skips a client | Config file missing or invalid JSON/TOML — fix manually then re-run |

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document one-command install quick start"
```

---

### Task 9: package.json test script + .gitignore

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add scripts**

```json
"scripts": {
  "test": "node --test",
  "test:configure": "node --test test/configure",
  "smoke:live": "node scripts/smoke-live.js",
  "benchmark": "node scripts/benchmark.js",
  "build:tarball": "bash scripts/build-release-tarball.sh"
}
```

- [ ] **Step 2: Ignore release artifacts**

Add to `.gitignore`:
```
.release/
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`  
Expected: all tests PASS (existing + new configure tests)

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: add configure test script and ignore release artifacts"
```

---

### Task 10: First release (manual)

- [ ] **Step 1: Push and tag**

```bash
git push origin main
git tag v0.2.0
git push origin v0.2.0
```

- [ ] **Step 2: Verify GitHub Release**

Confirm assets: `aws-docs-mcp-proxy-0.2.0.tar.gz`, `install.sh`

- [ ] **Step 3: End-to-end smoke on clean HOME**

```bash
HOME=/tmp/aws-docs-install-test curl -fsSL https://github.com/kichinosukey/aws-docs-mcp-proxy/releases/latest/download/install.sh | bash -s -- --yes --clients cursor
ls /tmp/aws-docs-install-test/.local/bin/aws-docs-mcp-proxy
```

Expected: symlink exists; `mcp.json` contains `aws_docs`

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| One-command install | Task 6, 10 |
| GitHub Releases tarball | Task 6, 7 |
| Cursor/Codex/Claude global config | Task 2–5 |
| Interactive overwrite (C) | Task 2, 4 |
| `--yes`, `--dry-run`, `--clients` flags | Task 5, 6 |
| Versioned install + symlinks | Task 1, 6 |
| Backup on overwrite | Task 2, 4 |
| Error: skip malformed client | Task 4, 5 |
| README update | Task 8 |
| CI release workflow | Task 7 |
| Node 20+ check in install.sh | Task 6 |
| PATH warning | Task 6 |

## Out of Scope (confirmed)

Windows, npm publish, aws login automation, uninstall, project-local configs, Marketplace — not in any task.
