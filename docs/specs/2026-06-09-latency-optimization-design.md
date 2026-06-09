# AWS Docs MCP Proxy — Latency Optimization Design

**Date:** 2026-06-09  
**Status:** Implemented (Phase 1 — pending manual quiz validation)  
**Scope:** Phase 1 — proxy cache + timing_ms; Cursor rule validation

## Purpose

Reduce end-to-end response time when using `aws-docs-mcp-proxy` inside coding agents, without turning the proxy into a quiz-specific or Cursor-specific tool.

Primary validation use case: AWS certification practice questions with optional images, answered via `aws_docs_evidence` in Cursor.

The proxy remains a **general-purpose compact AWS documentation lookup** layer. Cursor is Phase 1 validation only; Codex and Claude Code get equivalent agent guidance in a later phase.

## Problem Statement

Users perceive the full loop (send prompt → first activity → final answer) as slow, but cannot isolate which phase is slow.

Measured and observed bottlenecks (2026-06-09):

| Phase | Estimated cost | Notes |
|-------|----------------|-------|
| Image → text (Cursor internal) | Opaque, likely seconds | Agent receives `image_description`, not raw image; not measurable from proxy |
| `aws_docs_evidence` (cold) | ~3.5s | Local benchmark: search ~2.2s + read |
| Redundant agent MCP calls | +5–8s | Agent called `evidence`, then `search`, then `read`×2 on same question |
| Extra agent turns | ~10–20s per turn | Slow questions: 3–4 turns; fast questions: 2 turns |
| Verbose final answer | ~10–20s | Japanese explanation + comparison tables |

**Root cause:** MCP is not abnormally slow per call, but **call pattern and agent turn count** dominate. `aws_docs_evidence` already performs search + read internally; additional `search` / `read` calls are redundant.

## Goals

### Phase 1 (this spec)

1. One documentation question → **one `aws_docs_evidence` call** in typical agent sessions.
2. Repeat queries hit an in-process cache and return measurably faster.
3. Every tool response includes **`timing_ms`** so users can separate MCP latency from agent/model latency.
4. Validate behavior in **Cursor** via a project rule; proxy changes remain client-agnostic.

### Non-goals

- Quiz-only APIs, OCR pipelines, or answer-generation inside the proxy.
- Cursor-only features in the proxy binary.
- Fixing Cursor image preprocessing latency (out of scope).

## Architecture

```text
[Agent client]  e.g. Cursor (Phase 1), later Codex / Claude Code
  |
  | MCP stdio
  v
aws-docs-mcp-proxy
  |
  +-- DocsEvidenceService
  |     +-- search()  -----> [InMemoryCache] -----> AwsMcpClient
  |     +-- read()    -----> [InMemoryCache] -----> AwsMcpClient
  |     +-- evidence() -> search + read (both cached)
  |
  +-- Response envelope: { ..., timing_ms: { ... } }
  |
  v
https://aws-mcp.us-east-1.api.aws/mcp
```

## Component Design

### 1. In-memory TTL cache

**Location:** new module `src/docCache.js`, injected into `DocsEvidenceService`.

**Cache keys:**

| Operation | Key format |
|-----------|------------|
| `search` | `search:{normalizedQuery}:{topics.join(",")}:{limit}` |
| `read` | `read:{url}:{max_chars}:{start_index\|0}` |

**Normalization:** trim query, collapse internal whitespace, lowercase topics array after sort.

**TTL:** 10 minutes default. Configurable via env `AWS_DOCS_CACHE_TTL_MS` (optional; document in README).

**Max entries:** 200 per cache map (search / read separate). LRU eviction when full.

**Cached value:** the **compressed** result object already returned by `search` / `read` (not raw AWS MCP payload).

**Cache metadata in response:** add to `notes` array:

- `cache_hit: true|false` on search/read/evidence paths
- evidence inherits hits from its internal search/read

**Out of scope for v1:** disk persistence, distributed cache, ETag-based invalidation.

### 2. `timing_ms` field

Add a top-level `timing_ms` object to all three tool responses:

```json
{
  "results": [],
  "notes": [],
  "timing_ms": {
    "total": 3521,
    "search": 2180,
    "read": 1280,
    "cache": { "search_hit": false, "read_hit": false }
  }
}
```

**Rules:**

- `total`: wall clock for the tool handler.
- `search` / `read`: sub-phase timings inside `evidence`; standalone on individual tools.
- Omit sub-keys when not applicable (e.g. `search` tool has no `read`).
- Values are integers, milliseconds.

Implementation: thin `timed()` helper wrapping async calls in `DocsEvidenceService`.

### 3. Benchmark script update

Extend `scripts/benchmark.js` output:

```json
{
  "latency_ms": {
    "client_init": 972,
    "search": 2170,
    "read": 1280,
    "evidence_cold": 3518,
    "evidence_cached": 12
  }
}
```

Run evidence twice in benchmark to demonstrate cache effect.

### 4. Agent guidance (client-agnostic content, Phase 1 Cursor delivery)

**README section:** "Agent best practices"

- Prefer **`aws_docs_evidence` once** per question.
- Do **not** chain `evidence` → `search` → `read` unless the first result is clearly wrong.
- Keep final answers concise when the user only needs a multiple-choice letter.
- Optional tip: paste question text instead of screenshots to skip client-side image preprocessing.

**Phase 1 Cursor rule** (`~/.cursor/rules/aws-docs-mcp-efficiency.mdc` or project-local equivalent):

```markdown
# AWS Docs MCP efficiency

When using `aws_docs` MCP tools:

1. Call `aws_docs_evidence` once with the user's question. Do not call `aws_docs_search` or `aws_docs_read` afterward unless evidence is empty or clearly irrelevant.
2. Answer concisely. For multiple-choice questions: state the answer, one short citation, brief rejection of wrong options. Skip large tables unless asked.
3. Do not add exploratory tool calls "for thoroughness" on simple documentation lookups.
```

**Phase 2:** port the same guidance to Codex (`AGENTS.md` snippet) and Claude Code (`.claude/` rule) using existing configure scripts pattern — no proxy changes required.

## Error Handling

- Cache failures (e.g. bad env TTL) fall back to uncached behavior; log to stderr, never fail the tool call.
- `timing_ms` is always present even on error paths where partial work completed.
- AWS MCP auth errors unchanged; benchmark already surfaces `aws login` message.

## Testing

| Test | Type |
|------|------|
| Cache hit returns same compressed payload | unit |
| TTL expiry re-fetches | unit |
| LRU eviction at max entries | unit |
| `timing_ms` present on search/read/evidence | unit |
| evidence notes include cache_hit | unit |
| benchmark outputs latency_ms | integration (live, optional in CI) |

## Success Criteria (Phase 1)

1. Certification-style question in Cursor: **≤1 MCP tool call** in agent transcript.
2. Second identical `evidence` query: **`cache_hit: true`** and `total` < 100ms locally.
3. User can read `timing_ms.total` and compare to wall-clock wait to estimate non-MCP overhead.
4. README documents agent best practices without quiz-specific APIs.

## Rollout

1. Implement cache + timing in proxy; release patch version.
2. Add Cursor rule locally; re-run 5 certification questions from this session.
3. Compare agent transcript: tool call count and perceived latency.
4. If successful, open Phase 2 issue for Codex/Claude rule parity.

## Open Questions (resolved)

| Question | Decision |
|----------|----------|
| Cursor-only tool? | No. Phase 1 validates in Cursor only. |
| Quiz-specific features? | No. General docs lookup + agent discipline. |
| Cache TTL | 10 minutes default |
