# AWS Docs MCP Proxy — Public Release Design

## Purpose

Publish `aws-docs-mcp-proxy` as a public GitHub repository under `kichinosukey/aws-docs-mcp-proxy` so colleagues and the broader OSS community can clone and use it with Cursor, Codex, or Claude Code.

This is a **minimal public release**: README + `git clone` workflow. No npm publish, no CI, no GitHub Issue templates in v1.

## Goals

- First-time visitors understand **why** a thin proxy exists (not just what it does).
- Quantitative evidence shows the proxy reduces context size versus the full AWS MCP server.
- Colleagues can set up the proxy from README alone.
- The public repo contains no personal paths, internal project references, or agent workflow artifacts.

## Non-Goals

- npm registry publish or `npx` distribution.
- GitHub Actions CI.
- CONTRIBUTING.md, issue templates, or demo GIFs.
- Changing proxy behavior or adding features beyond release packaging.

## Audience

- Open source users (internal colleagues and external developers).
- Host: personal GitHub account `kichinosukey`.
- License: MIT.

## Distribution

Primary path:

```sh
git clone https://github.com/kichinosukey/aws-docs-mcp-proxy.git
cd aws-docs-mcp-proxy
npm test          # optional
```

MCP clients point `command` at the cloned `bin/aws-docs-mcp-proxy.js` path.

npm registry is **not** used in v1. `package.json` keeps `"private": true`.

## Documentation Strategy

### README (public face)

Add two sections before the existing Tools list:

#### `## Why this exists`

Explain the problem without disparaging the official AWS MCP server:

1. Full AWS MCP exposes a large tool catalog (CLI, boto3, CloudFormation, docs, etc.) — powerful for automation, heavy for doc-only use.
2. Two context costs without a proxy:
   - **Tool catalog noise** — many tool definitions load into the model context at session start.
   - **Payload size** — documentation reads can return long pages.
3. This proxy exposes three compact tools and compresses responses; final answers stay with the client model.
4. Use full AWS MCP for CLI execution and resource inspection; use this proxy for low-token documentation lookup.

#### `## Measured impact`

Include a table from reproducible benchmarks (see Benchmark Script below). Example numbers measured 2026-06-08 with query `Amazon EBS use case`:

| What | Full AWS MCP | This proxy | Reduction |
|------|-------------|------------|-----------|
| Tool definitions at session start | ~11,500 tokens (11 tools) | ~250 tokens (3 tools) | ~98% |
| One documentation question | ~1,800 tokens (search + read) | ~360 tokens (`aws_docs_evidence`) | ~80% |

Note that single `read` compression alone is modest (~10%) when `max_chars` is similar; the main wins are tool-catalog reduction and the one-shot `aws_docs_evidence` workflow.

Add disclaimer: unofficial project, not affiliated with AWS.

#### Setup fixes

- Replace absolute path `/Users/kichinosukey-mba/...` with a placeholder such as `/path/to/aws-docs-mcp-proxy/bin/aws-docs-mcp-proxy.js`.
- Keep `aws login` prerequisite and optional `npm test` / `npm run smoke:live`.

### `docs/superpowers/` — remove from public repo

The existing `docs/superpowers/` content is agent implementation workflow (checkbox plans, internal references to `apfel` and `aws-mcp-allowlist-proxy`). It is not useful for end users and adds noise.

Actions:

1. `git rm -r docs/superpowers`
2. Add `docs/superpowers/` to `.gitignore` so future local copies are not committed.
3. Optionally archive design history in personal `~/notes` (outside this repo).

The public repo has no `docs/` directory in v1. All user-facing documentation lives in README.

## Benchmark Script

Add `scripts/benchmark.js` and `npm run benchmark` to reproduce Measured impact numbers.

Behavior:

- Requires AWS authentication (`aws login`).
- Calls remote AWS MCP for `tools/list`, `aws___search_documentation`, `aws___read_documentation`.
- Compares raw payloads against proxy compression / `aws_docs_evidence`.
- Prints JSON summary to stdout with `measured_at`, `query`, `tool_catalog`, `search_response`, `read_response`, `evidence_one_shot`.
- Exits non-zero with actionable message on auth or connection failure.

Default query: `Amazon EBS use case` (overridable via CLI args).

README links to `npm run benchmark` for refreshing the table.

## Pre-Publish Checklist

| Item | Action |
|------|--------|
| LICENSE | Add MIT `LICENSE` at repo root |
| README | Why, Measured impact, generic paths, disclaimer |
| Benchmark | `scripts/benchmark.js` + `npm run benchmark` |
| Internal docs | Remove `docs/superpowers/`, gitignore path |
| Secrets scan | Verify no tokens, ARNs, or personal paths in history |
| `package.json` | Add `repository` field; keep `private: true` |
| Git remote | `git@github.com:kichinosukey/aws-docs-mcp-proxy.git` |
| GitHub settings | Public, description, topics (`mcp`, `aws`, `documentation`, `cursor`) |

## Publish Steps

```text
1. Complete pre-publish checklist locally
2. git remote add origin git@github.com:kichinosukey/aws-docs-mcp-proxy.git  (if not set)
3. git push -u origin main
4. Set GitHub repo description and topics
5. Share README URL with colleagues
```

## Success Criteria

- A new user with Node 20+ and `aws login` can clone, configure MCP, and call `aws_docs_evidence` successfully.
- README explains why the proxy exists without reading internal design docs.
- `npm run benchmark` reproduces order-of-magnitude reductions (~98% tool catalog, ~80% per-question).
- Public repo contains no `docs/superpowers/`, no personal absolute paths, no internal project names.

## Error Handling (User Onboarding)

Document in README:

- Auth failure → run `aws login` and retry.
- MCP client cannot find binary → use absolute path to cloned `bin/aws-docs-mcp-proxy.js`.
- Benchmark fails without credentials → expected; table values are from a prior local run.

## Testing Before Push

- `npm test` passes.
- `npm run smoke:live -- "Amazon EBS use case"` succeeds with valid AWS auth.
- `npm run benchmark` succeeds and output matches README table order of magnitude.
- Grep repo for `kichinosukey-mba`, `apfel`, `aws-mcp-allowlist` — zero hits.
