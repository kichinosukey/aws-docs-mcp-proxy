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

Prerequisites: Node.js 20+, `aws login`, macOS or Linux.

```sh
curl -fsSL https://github.com/kichinosukey/aws-docs-mcp-proxy/releases/latest/download/install.sh | bash
```

Restart your MCP client (Cursor, Codex, or Claude Code). The installer configures global `aws_docs` automatically.

To upgrade or overwrite an existing `aws_docs` entry (required when reinstalling via `curl | bash`, which cannot show y/N prompts):

```sh
curl -fsSL https://github.com/kichinosukey/aws-docs-mcp-proxy/releases/latest/download/install.sh | bash -s -- --yes
```

## Requirements

- AWS authentication that can access the remote AWS MCP endpoint (`aws login`)

If authentication expires, run `aws login` again.

## Test

```sh
npm test
```

## Live Smoke Test

```sh
npm run smoke:live -- "Amazon EBS use case"
```

## Advanced / Manual setup

<details>
<summary>Git clone and manual MCP client configuration</summary>

```sh
git clone https://github.com/kichinosukey/aws-docs-mcp-proxy.git
cd aws-docs-mcp-proxy
npm test          # optional
```

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

</details>

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `install.sh` fails on Node version | Install Node.js 20+ |
| Installer skips a client | Config file missing or invalid JSON/TOML — fix manually then re-run |
| Prompt appears then install ends (`curl \| bash`) | Piped installs are non-interactive; re-run with `bash -s -- --yes` (see Quick start) |
| `AWS MCP unavailable` or HTTP 401/403 | Run `aws login` and retry |
| MCP client cannot start the server | Use an absolute path to `bin/aws-docs-mcp-proxy.js` |
| `npm run benchmark` fails without credentials | Expected — README table values come from a prior authenticated run |

## License

MIT — see [LICENSE](LICENSE).
