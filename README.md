# AWS Docs MCP Proxy

Local MCP server that exposes compact AWS documentation tools for frontier model clients.

## Tools

- `aws_docs_search`: search AWS official documentation and return compact results.
- `aws_docs_read`: read one AWS documentation URL and return compact content.
- `aws_docs_evidence`: search a question, read the top result, and return evidence for the client model.

The proxy does not generate final answers, execute AWS CLI commands, or mutate AWS resources.

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
