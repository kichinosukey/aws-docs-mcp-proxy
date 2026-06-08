# AWS Docs MCP Proxy Design

## Purpose

Build a small local MCP server for frontier model clients such as Codex, Claude Code, and Cursor. The server provides low-token access to AWS official documentation through the remote AWS MCP server.

The proxy exists to avoid exposing the full AWS MCP tool catalog and long documentation payloads directly to the conversation context. It retrieves AWS documentation evidence, compresses it, and leaves final answer generation to the client model.

## Non-Goals

- Do not generate final answers.
- Do not execute AWS CLI commands.
- Do not mutate AWS resources.
- Do not include apfel-specific prompts, assumptions, or 4096-token compatibility behavior.
- Do not act as a general web reader.

## Architecture

The project lives in `~/projects/aws-docs-mcp-proxy`.

```text
MCP client
  -> local aws-docs-mcp-proxy
    -> AwsMcpClient
      -> https://aws-mcp.us-east-1.api.aws/mcp
```

The local proxy exposes only AWS documentation tools. Internally, it calls the remote AWS MCP tools:

- `aws___search_documentation`
- `aws___read_documentation`

### Components

`McpServer`

Handles stdio JSON-RPC for `initialize`, `tools/list`, and `tools/call`. It returns only the compact local tools.

`AwsMcpClient`

Handles JSON-RPC over HTTP/SSE to the remote AWS MCP endpoint. It stores and reuses `mcp-session-id`. The existing implementation in `aws-mcp-allowlist-proxy` can be reused as the starting point.

`DocsEvidenceService`

Implements the public tool behavior for search, read, and evidence gathering. It validates inputs, calls the AWS MCP client, and returns compact structured results.

`ResultCompressor`

Converts AWS MCP responses into small payloads. It trims result counts, shortens context, extracts relevant document content, and preserves source URLs.

## Public Tools

### `aws_docs_search`

Search AWS official documentation and return compact search results.

Input:

```json
{
  "query": "string",
  "topics": ["general"],
  "limit": 3
}
```

Output:

```json
{
  "results": [
    {
      "rank": 1,
      "title": "string",
      "url": "string",
      "context": "compressed context",
      "source_type": "documentation"
    }
  ],
  "notes": []
}
```

`topics` defaults to `["general"]`. `limit` defaults to `3` and should be capped to prevent large payloads.

### `aws_docs_read`

Read one AWS documentation URL and return compact content.

Input:

```json
{
  "url": "string",
  "max_chars": 4000,
  "start_index": 0
}
```

Output:

```json
{
  "title": "string",
  "url": "string",
  "content": "compressed content",
  "truncated": true,
  "next_start_index": 4000,
  "notes": []
}
```

The tool accepts only AWS documentation URLs supported by AWS MCP `read_documentation`. It rejects unrelated URLs.

### `aws_docs_evidence`

Search for a question, read the top documentation result, and return an evidence pack for the client model to use.

Input:

```json
{
  "question": "string",
  "topics": ["general"],
  "search_limit": 3,
  "read_chars": 4000
}
```

Output:

```json
{
  "question": "string",
  "sources": [
    {
      "rank": 1,
      "title": "string",
      "url": "string",
      "relevant_points": [
        "short evidence point"
      ],
      "excerpt": "short supporting excerpt"
    }
  ],
  "notes": []
}
```

This tool reads only the top search result by default. If the client needs more evidence, it can call `aws_docs_search` or `aws_docs_read` explicitly.

## Data Flow

`aws_docs_search`:

```text
client calls aws_docs_search
  -> validate query/topics/limit
  -> call AWS MCP aws___search_documentation
  -> parse JSON text payload
  -> keep top N
  -> truncate context
  -> return compact JSON
```

`aws_docs_read`:

```text
client calls aws_docs_read
  -> validate URL
  -> call AWS MCP aws___read_documentation
  -> parse response
  -> strip table-of-contents noise when possible
  -> return compact content and truncation metadata
```

`aws_docs_evidence`:

```text
client calls aws_docs_evidence
  -> search with question
  -> choose top result that has a URL
  -> read that URL
  -> extract compact evidence from search context and read content
  -> return sources[0] with title, URL, relevant points, and excerpt
```

## Error Handling

The proxy should fail softly where partial evidence is useful.

- AWS authentication or connection failure returns an MCP error with an actionable message such as `AWS MCP unavailable. Run aws login and retry.`
- Invalid input returns JSON-RPC `-32602`.
- AWS MCP response parse failure returns JSON-RPC `-32000` with a short diagnostic.
- Empty search results return `{ "results": [], "notes": [...] }`.
- If `aws_docs_evidence` search succeeds but read fails, return the search-derived source and include the read failure in `notes`.
- `aws_docs_read` rejects non-AWS documentation URLs.

## Testing

Use Node's built-in test runner.

Test coverage:

- `AwsMcpClient` parses JSON and SSE responses.
- `ResultCompressor` trims top-N results and truncates long context.
- `ResultCompressor` handles malformed AWS MCP payloads without crashing.
- `DocsEvidenceService` handles search, read, and evidence happy paths with a mocked AWS MCP client.
- `DocsEvidenceService` handles empty search results and read failures.
- `McpServer` handles `initialize`, `tools/list`, `tools/call`, invalid methods, and invalid inputs.
- Integration smoke test confirms `tools/list` returns only `aws_docs_search`, `aws_docs_read`, and `aws_docs_evidence`.
- Optional live smoke test calls AWS MCP for a simple query such as `Amazon EBS use case`.

## Success Criteria

- Frontier model clients see only three compact AWS documentation tools.
- A typical AWS certification-style question can be answered by calling `aws_docs_evidence` once and using the returned evidence.
- Tool responses stay small enough to avoid flooding the conversation with AWS MCP tool definitions or full documentation pages.
- The proxy preserves source URLs so final answers can cite AWS documentation.
- The existing apfel-focused proxy remains untouched.
