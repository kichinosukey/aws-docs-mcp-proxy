# Latency Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-memory caching and `timing_ms` telemetry to `aws-docs-mcp-proxy`, document agent best practices, and ship a Cursor rule template for Phase 1 validation.

**Architecture:** New `DocCache` module wraps compressed search/read results with TTL + LRU. `DocsEvidenceService` checks cache before calling `AwsMcpClient`, attaches `timing_ms` to every tool response, and records cache hits in `timing_ms.cache`. Benchmark script runs evidence twice to show cold vs cached latency. Agent guidance lives in README + a copyable Cursor rule file (not in proxy binary).

**Tech Stack:** Node.js 20+ (built-in test runner, `node:test`), existing `DocsEvidenceService` / `AwsMcpClient` / `mcpServer`

**Spec:** `docs/specs/2026-06-09-latency-optimization-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/docCache.js` | TTL + LRU in-memory cache, key builders, env TTL resolver |
| `src/timing.js` | `timed()` helper for millisecond measurements |
| `src/docsEvidenceService.js` | Cache integration, `timing_ms` on all methods |
| `bin/aws-docs-mcp-proxy.js` | Wire `DocCache` into service at startup |
| `test/docCache.test.js` | Cache unit tests |
| `test/docsEvidenceService.test.js` | Extend with cache + timing tests |
| `scripts/benchmark.js` | Add `latency_ms` cold/cached evidence |
| `README.md` | Agent best practices section |
| `docs/agent-guidance/cursor-aws-docs-mcp-efficiency.mdc` | Phase 1 Cursor rule template |

---

### Task 1: DocCache module

**Files:**
- Create: `src/docCache.js`
- Test: `test/docCache.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  DocCache,
  searchCacheKey,
  readCacheKey,
  resolveCacheTtlMs
} from "../src/docCache.js";

test("searchCacheKey normalizes query and topics", () => {
  const key = searchCacheKey({
    query: "  Amazon   EBS  ",
    topics: ["general", "reference_documentation"],
    limit: 3
  });
  assert.equal(key, "search:amazon ebs:general,reference_documentation:3");
});

test("readCacheKey includes url max_chars start_index", () => {
  const key = readCacheKey({
    url: "https://docs.aws.amazon.com/x",
    max_chars: 4000,
    start_index: 0
  });
  assert.equal(key, "read:https://docs.aws.amazon.com/x:4000:0");
});

test("get returns undefined on miss", () => {
  const cache = new DocCache({ ttlMs: 60_000 });
  assert.equal(cache.get("missing"), undefined);
});

test("get returns value before TTL expires", () => {
  const cache = new DocCache({ ttlMs: 60_000 });
  cache.set("k", { ok: true });
  assert.deepEqual(cache.get("k"), { ok: true });
});

test("get returns undefined after TTL expires", () => {
  let now = 1_000;
  const cache = new DocCache({
    ttlMs: 100,
    now: () => now
  });
  cache.set("k", { ok: true });
  now += 101;
  assert.equal(cache.get("k"), undefined);
});

test("LRU evicts oldest entry when maxEntries exceeded", () => {
  const cache = new DocCache({ ttlMs: 60_000, maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.set("c", 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
});

test("resolveCacheTtlMs uses env when valid", () => {
  const prev = process.env.AWS_DOCS_CACHE_TTL_MS;
  process.env.AWS_DOCS_CACHE_TTL_MS = "5000";
  assert.equal(resolveCacheTtlMs(), 5000);
  if (prev === undefined) {
    delete process.env.AWS_DOCS_CACHE_TTL_MS;
  } else {
    process.env.AWS_DOCS_CACHE_TTL_MS = prev;
  }
});

test("resolveCacheTtlMs falls back to default on invalid env", () => {
  const prev = process.env.AWS_DOCS_CACHE_TTL_MS;
  process.env.AWS_DOCS_CACHE_TTL_MS = "not-a-number";
  assert.equal(resolveCacheTtlMs(), 600_000);
  if (prev === undefined) {
    delete process.env.AWS_DOCS_CACHE_TTL_MS;
  } else {
    process.env.AWS_DOCS_CACHE_TTL_MS = prev;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/docCache.test.js`  
Expected: FAIL `Cannot find module '../src/docCache.js'`

- [ ] **Step 3: Implement DocCache**

```js
const DEFAULT_TTL_MS = 600_000;
const DEFAULT_MAX_ENTRIES = 200;

function normalizeQuery(query) {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

export function searchCacheKey({ query, topics, limit }) {
  const normalizedTopics = [...topics].sort().join(",");
  return `search:${normalizeQuery(query)}:${normalizedTopics}:${limit}`;
}

export function readCacheKey({ url, max_chars: maxChars, start_index: startIndex }) {
  const index = Number.isInteger(startIndex) && startIndex >= 0 ? startIndex : 0;
  return `read:${url}:${maxChars}:${index}`;
}

export function resolveCacheTtlMs() {
  const raw = process.env.AWS_DOCS_CACHE_TTL_MS;
  if (raw === undefined) {
    return DEFAULT_TTL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`aws-docs-mcp-proxy: invalid AWS_DOCS_CACHE_TTL_MS=${raw}, using default`);
    return DEFAULT_TTL_MS;
  }
  return parsed;
}

export class DocCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (this.now() - entry.at > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    this.store.set(key, { value, at: this.now() });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/docCache.test.js`  
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/docCache.js test/docCache.test.js
git commit -m "feat: add in-memory TTL LRU doc cache"
```

---

### Task 2: timing helper

**Files:**
- Create: `src/timing.js`
- Test: `test/timing.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { timed } from "../src/timing.js";

test("timed returns value and non-negative ms", async () => {
  const { value, ms } = await timed(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return "ok";
  });
  assert.equal(value, "ok");
  assert.ok(ms >= 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/timing.test.js`  
Expected: FAIL `Cannot find module`

- [ ] **Step 3: Implement timing helper**

```js
export async function timed(fn) {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}
```

- [ ] **Step 4: Run test**

Run: `node --test test/timing.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/timing.js test/timing.test.js
git commit -m "feat: add timed() helper for latency measurement"
```

---

### Task 3: Integrate cache + timing_ms into DocsEvidenceService

**Files:**
- Modify: `src/docsEvidenceService.js`
- Modify: `test/docsEvidenceService.test.js`

- [ ] **Step 1: Write failing tests for cache hit and timing_ms**

Append to `test/docsEvidenceService.test.js`:

```js
import { DocCache } from "../src/docCache.js";

test("search returns timing_ms and uses cache on second call", async () => {
  let calls = 0;
  const cache = new DocCache({ ttlMs: 60_000 });
  const service = new DocsEvidenceService({
    cache,
    client: {
      async callTool(name) {
        calls += 1;
        assert.equal(name, "aws___search_documentation");
        return makeSearchPayload([{ rank_order: 1, title: "EBS", url: "https://docs.aws.amazon.com/ebs", context: "Block storage." }]);
      }
    }
  });

  const first = await service.search({ query: "Amazon EBS use case" });
  assert.ok(first.timing_ms);
  assert.equal(typeof first.timing_ms.total, "number");
  assert.equal(first.timing_ms.cache.search_hit, false);
  assert.equal(calls, 1);

  const second = await service.search({ query: "Amazon EBS use case" });
  assert.equal(second.timing_ms.cache.search_hit, true);
  assert.equal(calls, 1);
  assert.deepEqual(second.results, first.results);
});

test("evidence returns timing_ms with search and read sub-phases", async () => {
  const cache = new DocCache({ ttlMs: 60_000 });
  const service = new DocsEvidenceService({
    cache,
    client: {
      async callTool(name, args) {
        if (name === "aws___search_documentation") {
          return makeSearchPayload([{ rank_order: 1, title: "Fargate", url: "https://docs.aws.amazon.com/ecs/fargate", context: "Serverless compute." }]);
        }
        return makeReadPayload("AWS Fargate content.", args.requests[0].url);
      }
    }
  });

  const result = await service.evidence({ question: "What is Fargate?" });
  assert.equal(typeof result.timing_ms.total, "number");
  assert.equal(typeof result.timing_ms.search, "number");
  assert.equal(typeof result.timing_ms.read, "number");
  assert.equal(result.timing_ms.cache.search_hit, false);
  assert.equal(result.timing_ms.cache.read_hit, false);
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `node --test test/docsEvidenceService.test.js`  
Expected: FAIL on `timing_ms` undefined

- [ ] **Step 3: Update DocsEvidenceService**

Key changes in `src/docsEvidenceService.js`:

1. Import `DocCache`, `searchCacheKey`, `readCacheKey` from `./docCache.js`
2. Import `timed` from `./timing.js`
3. Constructor: `constructor({ client, cache } = {})` — default `cache = new DocCache()`
4. Add private helper:

```js
async cachedSearch(args) {
  const key = searchCacheKey({
    query: ensureString(args.query ?? args.search_phrase, "query"),
    topics: normalizeTopics(args.topics),
    limit: clampInteger(args.limit, 3, MAX_SEARCH_LIMIT)
  });
  const hit = this.cache.get(key);
  if (hit) {
    return { result: hit, ms: 0, cacheHit: true };
  }
  const { value, ms } = await timed(() => this.searchUncached(args));
  this.cache.set(key, value);
  return { result: value, ms, cacheHit: false };
}
```

5. Refactor existing `search` body into `searchUncached`, then public `search`:

```js
async search(args = {}) {
  const totalStart = Date.now();
  const { result, ms, cacheHit } = await this.cachedSearch(args);
  return {
    ...result,
    timing_ms: {
      total: Date.now() - totalStart,
      search: ms,
      cache: { search_hit: cacheHit, read_hit: false }
    }
  };
}
```

6. Same pattern for `read` with `readCacheKey` and `readUncached`
7. `evidence`: call cached search/read helpers, aggregate `timing_ms`:

```js
async evidence(args = {}) {
  const totalStart = Date.now();
  const normalizedQuestion = ensureString(args.question, "question");
  const searchPhase = await this.cachedSearch({
    query: normalizedQuestion,
    topics: args.topics,
    limit: clampInteger(args.search_limit, 3, MAX_SEARCH_LIMIT)
  });
  const searchResult = searchPhase.result;
  const notes = [...searchResult.notes];
  // ... existing top URL logic ...
  // read phase uses cachedRead with read_chars clamp
  return {
    question: normalizedQuestion,
    sources,
    notes,
    timing_ms: {
      total: Date.now() - totalStart,
      search: searchPhase.ms,
      read: readPhase.ms,
      cache: {
        search_hit: searchPhase.cacheHit,
        read_hit: readPhase.cacheHit
      }
    }
  };
}
```

**Important:** `searchUncached` / `readUncached` must call `this.client.callTool` directly (no `timing_ms` wrapper) to avoid double-counting and recursive cache calls.

- [ ] **Step 4: Run all service tests**

Run: `node --test test/docsEvidenceService.test.js`  
Expected: PASS (6 tests)

- [ ] **Step 5: Run full test suite**

Run: `npm test`  
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/docsEvidenceService.js test/docsEvidenceService.test.js
git commit -m "feat: add cache and timing_ms to docs evidence service"
```

---

### Task 4: Wire cache at startup

**Files:**
- Modify: `bin/aws-docs-mcp-proxy.js`

- [ ] **Step 1: Update startup wiring**

```js
import { DocCache, resolveCacheTtlMs } from "../src/docCache.js";

// inside main():
const cache = new DocCache({ ttlMs: resolveCacheTtlMs() });
const service = new DocsEvidenceService({ client, cache });
```

- [ ] **Step 2: Smoke test locally**

Run: `npm test`  
Expected: PASS

Optional live check (requires `aws login`):

Run: `npm run smoke:live`  
Expected: successful tool responses containing `timing_ms`

- [ ] **Step 3: Commit**

```bash
git add bin/aws-docs-mcp-proxy.js
git commit -m "feat: enable doc cache from proxy startup"
```

---

### Task 5: Benchmark latency output

**Files:**
- Modify: `scripts/benchmark.js`

- [ ] **Step 1: Add latency measurement block**

After existing `evidence` call, add:

```js
const evidenceColdStart = Date.now();
const evidenceCold = await service.evidence({ question: query });
const evidenceColdMs = Date.now() - evidenceColdStart;

const evidenceCachedStart = Date.now();
const evidenceCached = await service.evidence({ question: query });
const evidenceCachedMs = Date.now() - evidenceCachedStart;

const initStart = Date.now();
await client.initialize();
const clientInitMs = Date.now() - initStart;
```

Move `client.initialize()` timing to before first tool call (measure once at start). Add to summary:

```js
latency_ms: {
  client_init: clientInitMs,
  search: searchMs,
  read: readMs,
  evidence_cold: evidenceColdMs,
  evidence_cached: evidenceCachedMs
}
```

Use `timed()` or `Date.now()` around individual `callTool` / `service.evidence` calls. Reuse one `DocsEvidenceService` with `DocCache` so second evidence hits cache.

- [ ] **Step 2: Run benchmark**

Run: `npm run benchmark -- "Amazon Neptune use cases"`  
Expected: JSON output includes `latency_ms.evidence_cached` significantly less than `evidence_cold`

- [ ] **Step 3: Commit**

```bash
git add scripts/benchmark.js
git commit -m "feat: report cold vs cached latency in benchmark"
```

---

### Task 6: README agent best practices

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add section after Tools**

```markdown
## Agent best practices

- Call **`aws_docs_evidence` once** per documentation question. It already runs search and read internally.
- Do not chain `aws_docs_evidence` → `aws_docs_search` → `aws_docs_read` unless the first result is empty or clearly wrong.
- Prefer concise final answers when the user only needs a short conclusion.
- Tool responses include `timing_ms` to separate MCP latency from model generation time.
- Optional: paste question text instead of screenshots to skip client-side image preprocessing.

### Cache

Responses are cached in memory for 10 minutes (override with `AWS_DOCS_CACHE_TTL_MS`). Repeat identical search/read/evidence calls return faster with `timing_ms.cache.*_hit: true`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add agent best practices and cache notes"
```

---

### Task 7: Cursor rule template (Phase 1 validation)

**Files:**
- Create: `docs/agent-guidance/cursor-aws-docs-mcp-efficiency.mdc`

- [ ] **Step 1: Create rule file**

```markdown
---
description: Efficient aws_docs MCP usage — one evidence call, concise answers
globs:
alwaysApply: false
---

# AWS Docs MCP efficiency

When using `aws_docs` MCP tools:

1. Call `aws_docs_evidence` once with the user's question. Do not call `aws_docs_search` or `aws_docs_read` afterward unless evidence is empty or clearly irrelevant.
2. Answer concisely. For multiple-choice questions: state the answer, one short citation, brief rejection of wrong options. Skip large tables unless asked.
3. Do not add exploratory tool calls "for thoroughness" on simple documentation lookups.
4. Use `timing_ms` in tool responses only for debugging when the user asks about latency.
```

- [ ] **Step 2: Document install step in README**

Add under Agent best practices:

```markdown
### Cursor (Phase 1)

Copy the rule template into your Cursor rules directory:

```sh
mkdir -p ~/.cursor/rules
cp docs/agent-guidance/cursor-aws-docs-mcp-efficiency.mdc ~/.cursor/rules/
```

Restart or reload Cursor so the rule is picked up.
```

- [ ] **Step 3: Commit**

```bash
git add docs/agent-guidance/cursor-aws-docs-mcp-efficiency.mdc README.md
git commit -m "docs: add Cursor rule template for aws_docs efficiency"
```

---

### Task 8: Phase 1 validation checklist

**Files:** none (manual validation)

- [ ] **Step 1: Install updated proxy locally**

```sh
cd /path/to/aws-docs-mcp-proxy
npm test
# if using release install:
bash scripts/build-release-tarball.sh
# or point ~/.cursor/mcp.json at repo bin for dev
```

- [ ] **Step 2: Install Cursor rule**

```sh
cp docs/agent-guidance/cursor-aws-docs-mcp-efficiency.mdc ~/.cursor/rules/
```

- [ ] **Step 3: Re-run 5 certification questions**

Use the same image-based prompts from the validation session. Check agent transcript for:

- ≤1 `aws_docs_*` tool call per question
- `timing_ms.cache.search_hit: true` on immediate repeat
- Shorter total wall-clock vs pre-change session

- [ ] **Step 4: Record results**

Add a short comment to the GitHub issue or a note in `docs/specs/2026-06-09-latency-optimization-design.md` status → **Validated** with date and observed tool-call counts.

- [ ] **Step 5: Bump patch version and tag (if releasing)**

Update `package.json` version `0.2.2` → `0.2.3`, commit, tag `v0.2.3`, push, let release workflow publish.

---

## Spec Coverage Check

| Spec requirement | Task |
|------------------|------|
| In-memory TTL cache | Task 1, 3, 4 |
| `timing_ms` on all tools | Task 2, 3 |
| Benchmark `latency_ms` | Task 5 |
| README agent best practices | Task 6 |
| Phase 1 Cursor rule | Task 7 |
| Phase 1 validation | Task 8 |
| Error handling invalid TTL | Task 1 (`resolveCacheTtlMs`) |
| evidence cache_hit metadata | Task 3 (`timing_ms.cache`) |

## Out of scope (Phase 2)

- Codex / Claude Code rule install via `configure-clients.js`
- Disk cache, distributed cache
- Image OCR pipeline
