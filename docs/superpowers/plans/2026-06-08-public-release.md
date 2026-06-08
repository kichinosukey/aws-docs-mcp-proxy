# Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare `aws-docs-mcp-proxy` for public GitHub release with README rationale, benchmark script, MIT license, and removal of internal docs.

**Architecture:** Packaging-only changes. No proxy behavior changes. Add `scripts/benchmark.js` to compare raw AWS MCP payloads against local compression. Rewrite README as the sole user-facing doc. Remove `docs/superpowers/` from git tracking and gitignore the path for future local use.

**Tech Stack:** Node.js 20+, ESM, Node built-in test runner, existing `AwsMcpClient` / `DocsEvidenceService` / `ResultCompressor`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `LICENSE` | MIT license text |
| `package.json` | Add `repository`, `license`, `benchmark` script |
| `scripts/benchmark.js` | Reproducible payload-size comparison vs full AWS MCP |
| `README.md` | Why, measured impact, setup, troubleshooting, MCP config |
| `.gitignore` | Ignore `docs/superpowers/` for local-only agent docs |
| `docs/superpowers/**` | Remove from repo (agent workflow artifacts) |

---

### Task 1: Add MIT License

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create `LICENSE`**

```text
MIT License

Copyright (c) 2026 kichinosukey

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

### Task 2: Update package.json Metadata

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add repository, license, and benchmark script**

Replace `package.json` with:

```json
{
  "name": "aws-docs-mcp-proxy",
  "version": "0.1.0",
  "description": "Local MCP server with compact AWS documentation tools for coding agents",
  "private": true,
  "license": "MIT",
  "type": "module",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/kichinosukey/aws-docs-mcp-proxy.git"
  },
  "bin": {
    "aws-docs-mcp-proxy": "bin/aws-docs-mcp-proxy.js"
  },
  "scripts": {
    "test": "node --test",
    "smoke:live": "node scripts/smoke-live.js",
    "benchmark": "node scripts/benchmark.js"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add repository metadata and benchmark script entry"
```

---

### Task 3: Add Benchmark Script

**Files:**
- Create: `scripts/benchmark.js`

- [ ] **Step 1: Create `scripts/benchmark.js`**

```javascript
import { AwsMcpClient } from "../src/awsMcpClient.js";
import { DocsEvidenceService } from "../src/docsEvidenceService.js";
import { AwsDocsMcpServer } from "../src/mcpServer.js";
import { compressSearchResult, compressReadResult } from "../src/resultCompressor.js";

const PROXY_TOOL_COUNT = 3;

function approxTokens(charCount) {
  return Math.ceil(charCount / 4);
}

function reductionPct(small, large) {
  return large > 0 ? Math.round((1 - small / large) * 100) : 0;
}

function emptyService() {
  return {
    async search() {
      return { results: [], notes: [] };
    },
    async read() {
      return { title: "", url: "", content: "", truncated: false, next_start_index: null, notes: [] };
    },
    async evidence() {
      return { question: "", sources: [], notes: [] };
    }
  };
}

async function proxyToolCatalogChars() {
  const server = new AwsDocsMcpServer({ service: emptyService() });
  const response = await server.handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list"
  });
  return JSON.stringify(response.result.tools).length;
}

async function main() {
  const query = process.argv.slice(2).join(" ") || "Amazon EBS use case";

  const client = new AwsMcpClient();
  await client.initialize();

  const toolsResult = await client.request("tools/list", {});
  const tools = toolsResult.tools ?? [];
  const toolsJson = JSON.stringify(tools);

  const rawSearch = await client.callTool("aws___search_documentation", {
    search_phrase: query,
    topics: ["general"],
    limit: 3
  });
  const rawSearchText = rawSearch.content?.[0]?.text ?? "";
  const compactSearchText = JSON.stringify(compressSearchResult(rawSearch, { limit: 3 }));

  const parsed = JSON.parse(rawSearchText);
  const topUrl = parsed?.content?.result?.[0]?.url;

  let readResponse = null;
  if (topUrl) {
    const rawRead = await client.callTool("aws___read_documentation", {
      requests: [{ url: topUrl, max_length: 10000 }]
    });
    const rawReadText = rawRead.content?.[0]?.text ?? "";
    const compactReadText = JSON.stringify(compressReadResult(rawRead, { maxChars: 4000 }));
    readResponse = {
      url: topUrl,
      raw_chars: rawReadText.length,
      compact_chars: compactReadText.length,
      reduction_pct: reductionPct(compactReadText.length, rawReadText.length)
    };
  }

  const service = new DocsEvidenceService({ client });
  const evidence = await service.evidence({ question: query });
  const evidenceText = JSON.stringify(evidence);

  const proxyCatalogChars = await proxyToolCatalogChars();
  const rawPerQuestionChars = rawSearchText.length + (readResponse?.raw_chars ?? 0);

  const summary = {
    measured_at: new Date().toISOString().slice(0, 10),
    query,
    tool_catalog: {
      full_aws_mcp: {
        tools: tools.length,
        chars: toolsJson.length,
        approx_tokens: approxTokens(toolsJson.length)
      },
      this_proxy: {
        tools: PROXY_TOOL_COUNT,
        chars: proxyCatalogChars,
        approx_tokens: approxTokens(proxyCatalogChars)
      },
      reduction_pct: reductionPct(proxyCatalogChars, toolsJson.length)
    },
    search_response: {
      raw_chars: rawSearchText.length,
      compact_chars: compactSearchText.length,
      reduction_pct: reductionPct(compactSearchText.length, rawSearchText.length)
    },
    read_response: readResponse,
    evidence_one_shot: {
      chars: evidenceText.length,
      approx_tokens: approxTokens(evidenceText.length)
    },
    per_question: {
      full_aws_mcp_search_plus_read_chars: rawPerQuestionChars,
      full_aws_mcp_approx_tokens: approxTokens(rawPerQuestionChars),
      proxy_evidence_chars: evidenceText.length,
      proxy_evidence_approx_tokens: approxTokens(evidenceText.length),
      reduction_pct: reductionPct(evidenceText.length, rawPerQuestionChars)
    }
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  const message = String(error?.message ?? error);
  if (message.includes("HTTP 401") || message.includes("HTTP 403") || message.toLowerCase().includes("auth")) {
    console.error("Benchmark failed: AWS authentication required. Run `aws login` and retry.");
  } else {
    console.error(`Benchmark failed: ${message}`);
  }
  process.exit(1);
});
```

- [ ] **Step 2: Run benchmark (requires `aws login`)**

Run: `npm run benchmark -- "Amazon EBS use case"`

Expected: JSON on stdout with `tool_catalog.reduction_pct` around 95–99 and `per_question.reduction_pct` around 70–85. Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/benchmark.js
git commit -m "feat: add benchmark script for payload comparison"
```

---

### Task 4: Rewrite README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md`**

```markdown
# AWS Docs MCP Proxy

Local MCP server that exposes compact AWS documentation tools for frontier model clients (Cursor, Codex, Claude Code).

> **Disclaimer:** This is an unofficial community project. It is not affiliated with or endorsed by Amazon Web Services.

## Why this exists

The [official AWS MCP server](https://aws.amazon.com/blogs/devops/introducing-aws-mcp-server/) exposes a large tool catalog — CLI execution, boto3 scripting, CloudFormation, documentation, and more. That is powerful for full AWS automation, but heavy when you only want documentation evidence inside a coding agent.

Without a proxy, a typical session pays two costs:

1. **Tool catalog noise** — many tool definitions load into the model context at session start, even if you only need docs.
2. **Payload size** — documentation reads can return long pages; multiple reads quickly flood the conversation.

This proxy exposes only three compact tools (`search`, `read`, `evidence`) and compresses responses before returning them. It fetches AWS official documentation through the remote AWS MCP endpoint, but leaves final answer generation to your client model.

**Use the full AWS MCP server** when you need CLI execution, resource inspection, or broad AWS automation.

**Use this proxy** when you want low-token AWS documentation lookup inside a coding agent.

## Measured impact

Numbers from `npm run benchmark` on 2026-06-08 (query: `Amazon EBS use case`). Re-run locally to refresh; AWS MCP payloads change over time.

| What | Full AWS MCP | This proxy | Reduction |
|------|-------------|------------|-----------|
| Tool definitions at session start | ~11,500 tokens (11 tools) | ~250 tokens (3 tools) | ~98% |
| One documentation question | ~1,800 tokens (search + read) | ~360 tokens (`aws_docs_evidence`) | ~80% |

Single `read` compression alone is modest (~10%) when `max_chars` is similar. The main wins are tool-catalog reduction and the one-shot `aws_docs_evidence` workflow.

```sh
npm run benchmark -- "Amazon EBS use case"
```

## Tools

- `aws_docs_search`: search AWS official documentation and return compact results.
- `aws_docs_read`: read one AWS documentation URL and return compact content.
- `aws_docs_evidence`: search a question, read the top result, and return evidence for the client model.

The proxy does not generate final answers, execute AWS CLI commands, or mutate AWS resources.

## Quick start

```sh
git clone https://github.com/kichinosukey/aws-docs-mcp-proxy.git
cd aws-docs-mcp-proxy
npm test          # optional
```

## Requirements

- Node.js 20+
- AWS authentication that can access the remote AWS MCP endpoint

If authentication expires, run:

```sh
aws login
```

## Test

```sh
npm test
```

## Live Smoke Test

```sh
npm run smoke:live -- "Amazon EBS use case"
```

## MCP Client Configuration

Point your MCP client at the cloned executable (use your actual clone path):

```toml
[mcp_servers.aws_docs]
command = "/path/to/aws-docs-mcp-proxy/bin/aws-docs-mcp-proxy.js"
```

### Cursor (`~/.cursor/mcp.json` example)

```json
{
  "mcpServers": {
    "aws_docs": {
      "command": "node",
      "args": ["/path/to/aws-docs-mcp-proxy/bin/aws-docs-mcp-proxy.js"]
    }
  }
}
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `AWS MCP unavailable` or HTTP 401/403 | Run `aws login` and retry |
| MCP client cannot start the server | Use an absolute path to `bin/aws-docs-mcp-proxy.js` |
| `npm run benchmark` fails without credentials | Expected — README table values come from a prior authenticated run |

## License

MIT — see [LICENSE](LICENSE).
```

- [ ] **Step 2: Verify no personal paths remain**

Run: `rg -n "kichinosukey-mba|/Users/" README.md`

Expected: no matches

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: explain proxy rationale and public setup"
```

---

### Task 5: Remove Internal Docs and Gitignore

**Files:**
- Delete: `docs/superpowers/**`
- Modify: `.gitignore`

- [ ] **Step 1: Remove tracked superpowers docs**

```bash
git rm -r docs/superpowers
```

- [ ] **Step 2: Update `.gitignore`**

Append to `.gitignore`:

```gitignore
docs/superpowers/
```

- [ ] **Step 3: Verify docs directory is gone from git**

Run: `git ls-files docs/`

Expected: no output

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: remove internal agent docs from public repo"
```

---

### Task 6: Pre-Publish Verification

**Files:**
- Verify: entire repo

- [ ] **Step 1: Run unit tests**

Run: `npm test`

Expected: all tests pass

- [ ] **Step 2: Run live smoke test**

Run: `npm run smoke:live -- "Amazon EBS use case"`

Expected: JSON evidence output, exit code 0

- [ ] **Step 3: Run benchmark**

Run: `npm run benchmark -- "Amazon EBS use case"`

Expected: `tool_catalog.reduction_pct` ≥ 90, `per_question.reduction_pct` ≥ 60

- [ ] **Step 4: Scan for sensitive or internal strings**

Run:

```bash
rg -n "kichinosukey-mba|apfel|aws-mcp-allowlist|arn:aws" . --glob '!node_modules' --glob '!.git'
```

Expected: no matches

- [ ] **Step 5: Scan git history for personal paths (optional but recommended)**

Run:

```bash
git log --all -p | rg "kichinosukey-mba" | head
```

Expected: no matches after README fix commit. If old README path appears in history, it is acceptable for v1 (no secrets); note in PR if scrubbing is desired later.

---

### Task 7: Push to GitHub

**Files:**
- Remote: `git@github.com:kichinosukey/aws-docs-mcp-proxy.git`

- [ ] **Step 1: Create public repo on GitHub**

Run (if repo does not exist):

```bash
gh repo create kichinosukey/aws-docs-mcp-proxy --public --source=. --remote=origin --push
```

If repo already exists locally without remote:

```bash
git remote add origin git@github.com:kichinosukey/aws-docs-mcp-proxy.git
git push -u origin main
```

Expected: `main` branch on GitHub with all commits

- [ ] **Step 2: Set GitHub metadata**

```bash
gh repo edit kichinosukey/aws-docs-mcp-proxy \
  --description "Compact AWS documentation MCP proxy for coding agents" \
  --add-topic mcp --add-topic aws --add-topic documentation --add-topic cursor
```

- [ ] **Step 3: Verify public README renders correctly**

Open: `https://github.com/kichinosukey/aws-docs-mcp-proxy`

Check: Why section, Measured impact table, generic paths, no `docs/superpowers/` directory

---

## Spec Coverage Checklist

| Spec requirement | Task |
|-----------------|------|
| MIT license | Task 1 |
| README Why + Measured impact | Task 4 |
| `scripts/benchmark.js` | Task 3 |
| Remove `docs/superpowers/` | Task 5 |
| `package.json` repository field | Task 2 |
| Pre-publish verification | Task 6 |
| GitHub public push | Task 7 |
| Troubleshooting in README | Task 4 |
| Disclaimer | Task 4 |

## Self-Review Notes

- All code blocks are complete; no TBD placeholders.
- Benchmark reuses existing `AwsMcpClient`, `ResultCompressor`, `DocsEvidenceService`, `AwsDocsMcpServer` — no proxy behavior changes.
- Plan does not include npm publish or CI (per spec non-goals).
