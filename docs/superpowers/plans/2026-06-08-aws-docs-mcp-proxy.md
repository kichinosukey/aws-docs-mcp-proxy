# AWS Docs MCP Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local MCP server that exposes compact AWS documentation search, read, and evidence tools for Codex, Claude Code, and Cursor.

**Architecture:** The server is a small Node.js stdio MCP proxy. It exposes three local tools and forwards to the remote AWS MCP `search_documentation` and `read_documentation` tools through a reusable JSON-RPC HTTP/SSE client. Search and read responses are compressed before being returned to the client model.

**Tech Stack:** Node.js 20+, ESM, Node built-in test runner, stdio JSON-RPC, AWS MCP remote endpoint.

---

## File Structure

- Create `package.json`: project metadata, executable bin, test and smoke scripts.
- Create `bin/aws-docs-mcp-proxy.js`: executable stdio entrypoint.
- Create `src/awsMcpClient.js`: remote AWS MCP JSON-RPC HTTP/SSE client with `mcp-session-id` support.
- Create `src/resultCompressor.js`: parse and compress AWS MCP search/read responses.
- Create `src/docsEvidenceService.js`: implement `aws_docs_search`, `aws_docs_read`, and `aws_docs_evidence`.
- Create `src/mcpServer.js`: local MCP server protocol handling and tool schemas.
- Create `test/awsMcpClient.test.js`: client parser and session tests.
- Create `test/resultCompressor.test.js`: search/read compression tests.
- Create `test/docsEvidenceService.test.js`: service behavior with mocked AWS MCP client.
- Create `test/mcpServer.test.js`: JSON-RPC protocol tests.
- Create `scripts/smoke-live.js`: optional live AWS MCP smoke test.
- Modify `README.md`: basic usage, tool list, and authentication note.

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "aws-docs-mcp-proxy",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "aws-docs-mcp-proxy": "bin/aws-docs-mcp-proxy.js"
  },
  "scripts": {
    "test": "node --test",
    "smoke:live": "node scripts/smoke-live.js"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Create `README.md`**

```markdown
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
```

- [ ] **Step 3: Run scaffold check**

Run: `npm test`

Expected: exits with code `0` and reports no tests found or zero executed tests.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "chore: scaffold AWS docs MCP proxy"
```

## Task 2: AWS MCP Client

**Files:**
- Create: `src/awsMcpClient.js`
- Create: `test/awsMcpClient.test.js`

- [ ] **Step 1: Write failing parser tests**

Create `test/awsMcpClient.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseAwsMcpResponse, AwsMcpClient } from "../src/awsMcpClient.js";

test("parseAwsMcpResponse parses plain JSON", () => {
  const message = parseAwsMcpResponse('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
  assert.deepEqual(message, { jsonrpc: "2.0", id: 1, result: { ok: true } });
});

test("parseAwsMcpResponse parses JSON-RPC from SSE frames", () => {
  const message = parseAwsMcpResponse('event: message\\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\\n\\n');
  assert.deepEqual(message, { jsonrpc: "2.0", id: 2, result: { ok: true } });
});

test("AwsMcpClient stores mcp-session-id and reuses it", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return {
      ok: true,
      headers: {
        get(name) {
          return name === "mcp-session-id" ? "session-1" : undefined;
        }
      },
      async text() {
        const body = JSON.parse(init.body);
        return JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { ok: true } });
      }
    };
  };

  const client = new AwsMcpClient({ url: "https://example.test/mcp", fetchImpl });
  await client.request("initialize", {});
  await client.request("tools/list", {});

  assert.equal(requests[1].init.headers["mcp-session-id"], "session-1");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test`

Expected: FAIL with module not found for `src/awsMcpClient.js`.

- [ ] **Step 3: Implement `src/awsMcpClient.js`**

```js
export const AWS_MCP_URL = "https://aws-mcp.us-east-1.api.aws/mcp";

let nextRequestId = 1;

export function parseAwsMcpResponse(text) {
  const trimmed = text.trim();

  if (trimmed.startsWith("{")) {
    return JSON.parse(text);
  }

  const frames = text.split(/\r?\n\r?\n/);

  for (const frame of frames) {
    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
      continue;
    }

    const payload = dataLines.join("\n");

    try {
      const message = JSON.parse(payload);
      if (message?.jsonrpc === "2.0") {
        return message;
      }
    } catch {
    }
  }

  return JSON.parse(text);
}

function formatJsonRpcError(error) {
  const code = error.code === undefined ? "unknown" : error.code;
  const detail = error.message ?? JSON.stringify(error.data ?? error);
  return `${code}: ${detail}`;
}

export class AwsMcpClient {
  constructor({ url = AWS_MCP_URL, fetchImpl = globalThis.fetch } = {}) {
    if (!fetchImpl) {
      throw new Error("fetch is required");
    }

    this.url = url;
    this.fetchImpl = fetchImpl;
    this.sessionId = undefined;
  }

  async request(method, params = {}) {
    const id = nextRequestId++;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    };

    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }

    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
    });

    const text = await response.text();
    const sessionId = response.headers?.get?.("mcp-session-id");

    if (sessionId) {
      this.sessionId = sessionId;
    }

    if (!response.ok) {
      throw new Error(`AWS MCP HTTP ${response.status}: ${text}`);
    }

    const message = parseAwsMcpResponse(text);

    if (message.id !== id) {
      throw new Error(`AWS MCP ${method} response id mismatch: expected ${id}, got ${message.id}`);
    }

    if (message.error) {
      throw new Error(`AWS MCP ${method} error: ${formatJsonRpcError(message.error)}`);
    }

    return message.result;
  }

  initialize() {
    return this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "aws-docs-mcp-proxy", version: "0.1.0" }
    });
  }

  callTool(name, args = {}) {
    return this.request("tools/call", { name, arguments: args });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/awsMcpClient.js test/awsMcpClient.test.js
git commit -m "feat: add AWS MCP client"
```

## Task 3: Result Compressor

**Files:**
- Create: `src/resultCompressor.js`
- Create: `test/resultCompressor.test.js`

- [ ] **Step 1: Write failing compressor tests**

Create `test/resultCompressor.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  compressSearchResult,
  compressReadResult,
  extractEvidencePoints
} from "../src/resultCompressor.js";

test("compressSearchResult keeps top results and truncates context", () => {
  const result = compressSearchResult({
    content: [{
      type: "text",
      text: JSON.stringify({
        content: {
          result: [
            { rank_order: 1, title: "One", url: "https://docs.aws.amazon.com/one", context: "A".repeat(500) },
            { rank_order: 2, title: "Two", url: "https://aws.amazon.com/two", context: "B".repeat(20) },
            { rank_order: 3, title: "Three", skill_name: "skill", skill_description: "C".repeat(20) }
          ]
        }
      })
    }]
  }, { limit: 2, contextChars: 80 });

  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].rank, 1);
  assert.equal(result.results[0].context.length, 80);
  assert.equal(result.results[0].source_type, "documentation");
  assert.equal(result.results[1].source_type, "aws_site");
});

test("compressSearchResult returns notes for malformed payload", () => {
  const result = compressSearchResult({ content: [{ type: "text", text: "not json" }] });
  assert.deepEqual(result.results, []);
  assert.equal(result.notes.length, 1);
});

test("compressReadResult returns compact document content", () => {
  const result = compressReadResult({
    content: [{
      type: "text",
      text: JSON.stringify({
        content: {
          result: [{
            status: "SUCCESS",
            url: "https://docs.aws.amazon.com/example",
            content: "# Title\\n\\nTable of Contents:\\n- A\\n\\nUseful content here.",
            truncated: true,
            end_index: 4000
          }]
        }
      })
    }]
  }, { maxChars: 20 });

  assert.equal(result.title, "Title");
  assert.equal(result.content, "Useful content here.");
  assert.equal(result.truncated, true);
  assert.equal(result.next_start_index, 4000);
});

test("extractEvidencePoints returns short lines", () => {
  const points = extractEvidencePoints("First useful sentence. Second useful sentence. Third useful sentence.", 2);
  assert.deepEqual(points, ["First useful sentence.", "Second useful sentence."]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test`

Expected: FAIL with module not found for `src/resultCompressor.js`.

- [ ] **Step 3: Implement `src/resultCompressor.js`**

```js
export function truncateText(text, maxLength = 360) {
  if (typeof text !== "string") {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function textContent(result) {
  return result?.content?.find?.((item) => item.type === "text")?.text;
}

function parseAwsTextPayload(result) {
  const text = textContent(result);
  if (typeof text !== "string") {
    throw new Error("AWS MCP result did not contain text content");
  }
  return JSON.parse(text);
}

function sourceType(row) {
  if (row.skill_name) {
    return "skill";
  }
  if (typeof row.url === "string" && row.url.includes("docs.aws.amazon.com")) {
    return "documentation";
  }
  return "aws_site";
}

export function compressSearchResult(result, { limit = 3, contextChars = 360 } = {}) {
  try {
    const parsed = parseAwsTextPayload(result);
    const rows = parsed?.content?.result;

    if (!Array.isArray(rows)) {
      return { results: [], notes: ["AWS MCP search payload did not contain result rows."] };
    }

    return {
      results: rows.slice(0, limit).map((row, index) => ({
        rank: row.rank_order ?? index + 1,
        title: row.title ?? "",
        url: row.url ?? "",
        context: truncateText(row.context ?? row.skill_description ?? "", contextChars),
        source_type: sourceType(row)
      })),
      notes: []
    };
  } catch (error) {
    return { results: [], notes: [`Failed to parse AWS MCP search result: ${error.message}`] };
  }
}

function stripToc(content) {
  return content
    .replace(/Table of Contents:\n(?:- .*\n)+\n?/m, "")
    .replace(/^Note: Page redirected.*\n\n/m, "")
    .trim();
}

function titleFromContent(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

export function compressReadResult(result, { maxChars = 4000 } = {}) {
  try {
    const parsed = parseAwsTextPayload(result);
    const row = parsed?.content?.result?.[0];

    if (!row || row.status !== "SUCCESS") {
      return {
        title: "",
        url: row?.url ?? "",
        content: "",
        truncated: false,
        next_start_index: null,
        notes: [`AWS MCP read failed with status: ${row?.status ?? "missing"}`]
      };
    }

    const stripped = stripToc(row.content ?? "");

    return {
      title: titleFromContent(stripped),
      url: row.redirected_url ?? row.url ?? "",
      content: truncateText(stripped.replace(/^#\s+.+\n+/, ""), maxChars),
      truncated: row.truncated === true,
      next_start_index: row.truncated === true ? row.end_index ?? null : null,
      notes: []
    };
  } catch (error) {
    return {
      title: "",
      url: "",
      content: "",
      truncated: false,
      next_start_index: null,
      notes: [`Failed to parse AWS MCP read result: ${error.message}`]
    };
  }
}

export function extractEvidencePoints(content, limit = 3) {
  return String(content)
    .split(/(?<=[.。])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => truncateText(item, 220));
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/resultCompressor.js test/resultCompressor.test.js
git commit -m "feat: add documentation result compression"
```

## Task 4: Docs Evidence Service

**Files:**
- Create: `src/docsEvidenceService.js`
- Create: `test/docsEvidenceService.test.js`

- [ ] **Step 1: Write failing service tests**

Create `test/docsEvidenceService.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { DocsEvidenceService } from "../src/docsEvidenceService.js";

function makeSearchPayload(rows) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ content: { result: rows } })
    }]
  };
}

function makeReadPayload(content) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        content: {
          result: [{
            status: "SUCCESS",
            url: "https://docs.aws.amazon.com/example",
            content,
            truncated: false
          }]
        }
      })
    }]
  };
}

test("search calls AWS MCP search_documentation", async () => {
  const calls = [];
  const service = new DocsEvidenceService({
    client: {
      async callTool(name, args) {
        calls.push([name, args]);
        return makeSearchPayload([{ rank_order: 1, title: "EBS", url: "https://docs.aws.amazon.com/ebs", context: "Block storage." }]);
      }
    }
  });

  const result = await service.search({ query: "Amazon EBS use case" });
  assert.equal(calls[0][0], "aws___search_documentation");
  assert.equal(calls[0][1].search_phrase, "Amazon EBS use case");
  assert.equal(result.results[0].title, "EBS");
});

test("read rejects non-AWS URLs", async () => {
  const service = new DocsEvidenceService({ client: { async callTool() {} } });
  await assert.rejects(
    () => service.read({ url: "https://example.com/not-aws" }),
    /Unsupported AWS documentation URL/
  );
});

test("evidence reads top search result and returns source", async () => {
  const calls = [];
  const service = new DocsEvidenceService({
    client: {
      async callTool(name, args) {
        calls.push([name, args]);
        if (name === "aws___search_documentation") {
          return makeSearchPayload([{ rank_order: 1, title: "Fargate", url: "https://docs.aws.amazon.com/ecs/fargate", context: "Serverless compute for containers." }]);
        }
        return makeReadPayload("# Fargate\\n\\nAWS Fargate runs containers without managing servers. You specify CPU and memory.");
      }
    }
  });

  const result = await service.evidence({ question: "What is Fargate?" });
  assert.equal(calls[1][0], "aws___read_documentation");
  assert.equal(result.sources[0].title, "Fargate");
  assert.equal(result.sources[0].url, "https://docs.aws.amazon.com/ecs/fargate");
  assert.ok(result.sources[0].relevant_points.length > 0);
});

test("evidence returns empty sources when search has no URL", async () => {
  const service = new DocsEvidenceService({
    client: {
      async callTool() {
        return makeSearchPayload([{ rank_order: 1, title: "Skill", skill_name: "skill", skill_description: "No URL." }]);
      }
    }
  });

  const result = await service.evidence({ question: "Question" });
  assert.deepEqual(result.sources, []);
  assert.ok(result.notes.some((note) => note.includes("No readable AWS documentation URL")));
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test`

Expected: FAIL with module not found for `src/docsEvidenceService.js`.

- [ ] **Step 3: Implement `src/docsEvidenceService.js`**

```js
import {
  compressSearchResult,
  compressReadResult,
  extractEvidencePoints,
  truncateText
} from "./resultCompressor.js";

const DEFAULT_TOPICS = ["general"];
const MAX_SEARCH_LIMIT = 5;
const MAX_READ_CHARS = 8000;

function ensureString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeTopics(topics) {
  if (topics === undefined) {
    return DEFAULT_TOPICS;
  }
  if (!Array.isArray(topics) || topics.some((topic) => typeof topic !== "string")) {
    throw new Error("topics must be an array of strings");
  }
  return topics.length === 0 ? DEFAULT_TOPICS : topics;
}

function clampInteger(value, defaultValue, maxValue) {
  if (!Number.isInteger(value)) {
    return defaultValue;
  }
  return Math.min(Math.max(value, 1), maxValue);
}

export function isAllowedAwsDocsUrl(url) {
  try {
    const parsed = new URL(url);
    return [
      "docs.aws.amazon.com",
      "aws.amazon.com",
      "repost.aws",
      "docs.amplify.aws",
      "ui.docs.amplify.aws",
      "strandsagents.com"
    ].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export class DocsEvidenceService {
  constructor({ client } = {}) {
    if (!client) {
      throw new Error("client is required");
    }
    this.client = client;
  }

  async search({ query, topics, limit } = {}) {
    const searchPhrase = ensureString(query, "query");
    const normalizedTopics = normalizeTopics(topics);
    const normalizedLimit = clampInteger(limit, 3, MAX_SEARCH_LIMIT);

    const result = await this.client.callTool("aws___search_documentation", {
      search_phrase: searchPhrase,
      topics: normalizedTopics,
      limit: normalizedLimit
    });

    return compressSearchResult(result, { limit: normalizedLimit });
  }

  async read({ url, max_chars: maxChars, start_index: startIndex } = {}) {
    const normalizedUrl = ensureString(url, "url");
    if (!isAllowedAwsDocsUrl(normalizedUrl)) {
      throw new Error(`Unsupported AWS documentation URL: ${normalizedUrl}`);
    }

    const normalizedMaxChars = clampInteger(maxChars, 4000, MAX_READ_CHARS);
    const request = {
      url: normalizedUrl,
      max_length: normalizedMaxChars
    };

    if (Number.isInteger(startIndex) && startIndex >= 0) {
      request.start_index = startIndex;
    }

    const result = await this.client.callTool("aws___read_documentation", {
      requests: [request]
    });

    return compressReadResult(result, { maxChars: normalizedMaxChars });
  }

  async evidence({ question, topics, search_limit: searchLimit, read_chars: readChars } = {}) {
    const normalizedQuestion = ensureString(question, "question");
    const searchResult = await this.search({
      query: normalizedQuestion,
      topics,
      limit: clampInteger(searchLimit, 3, MAX_SEARCH_LIMIT)
    });

    const top = searchResult.results.find((row) => row.url && isAllowedAwsDocsUrl(row.url));
    const notes = [...searchResult.notes];

    if (!top) {
      notes.push("No readable AWS documentation URL found in search results.");
      return { question: normalizedQuestion, sources: [], notes };
    }

    try {
      const readResult = await this.read({
        url: top.url,
        max_chars: clampInteger(readChars, 4000, MAX_READ_CHARS)
      });
      notes.push(...readResult.notes);

      return {
        question: normalizedQuestion,
        sources: [{
          rank: top.rank,
          title: readResult.title || top.title,
          url: readResult.url || top.url,
          relevant_points: extractEvidencePoints(`${top.context} ${readResult.content}`, 3),
          excerpt: truncateText(readResult.content || top.context, 700)
        }],
        notes
      };
    } catch (error) {
      notes.push(`Read failed for ${top.url}: ${error.message}`);
      return {
        question: normalizedQuestion,
        sources: [{
          rank: top.rank,
          title: top.title,
          url: top.url,
          relevant_points: extractEvidencePoints(top.context, 3),
          excerpt: truncateText(top.context, 700)
        }],
        notes
      };
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/docsEvidenceService.js test/docsEvidenceService.test.js
git commit -m "feat: add AWS docs evidence service"
```

## Task 5: Local MCP Server

**Files:**
- Create: `src/mcpServer.js`
- Create: `test/mcpServer.test.js`

- [ ] **Step 1: Write failing MCP server tests**

Create `test/mcpServer.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { AwsDocsMcpServer } from "../src/mcpServer.js";

function makeService() {
  return {
    async search(args) {
      return { results: [{ rank: 1, title: args.query, url: "https://docs.aws.amazon.com/x", context: "ctx", source_type: "documentation" }], notes: [] };
    },
    async read() {
      return { title: "Doc", url: "https://docs.aws.amazon.com/x", content: "content", truncated: false, next_start_index: null, notes: [] };
    },
    async evidence(args) {
      return { question: args.question, sources: [], notes: [] };
    }
  };
}

test("initialize returns MCP capabilities", async () => {
  const server = new AwsDocsMcpServer({ service: makeService() });
  const response = await server.handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(response.result.serverInfo.name, "aws-docs-mcp-proxy");
  assert.deepEqual(response.result.capabilities, { tools: { listChanged: false } });
});

test("tools/list returns three local tools", async () => {
  const server = new AwsDocsMcpServer({ service: makeService() });
  const response = await server.handleJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.deepEqual(response.result.tools.map((tool) => tool.name), [
    "aws_docs_search",
    "aws_docs_read",
    "aws_docs_evidence"
  ]);
});

test("tools/call dispatches aws_docs_search", async () => {
  const server = new AwsDocsMcpServer({ service: makeService() });
  const response = await server.handleJsonRpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "aws_docs_search", arguments: { query: "EBS" } }
  });

  assert.equal(response.result.content[0].type, "text");
  assert.equal(JSON.parse(response.result.content[0].text).results[0].title, "EBS");
});

test("tools/call rejects unknown tool", async () => {
  const server = new AwsDocsMcpServer({ service: makeService() });
  const response = await server.handleJsonRpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "aws___call_aws", arguments: {} }
  });

  assert.equal(response.error.code, -32602);
});

test("notifications do not produce responses", async () => {
  const server = new AwsDocsMcpServer({ service: makeService() });
  const response = await server.handleJsonRpc({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  assert.equal(response, undefined);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test`

Expected: FAIL with module not found for `src/mcpServer.js`.

- [ ] **Step 3: Implement `src/mcpServer.js`**

```js
const TOOL_DEFINITIONS = [
  {
    name: "aws_docs_search",
    description: "Search AWS official documentation and return compact results.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        topics: { type: "array", items: { type: "string" } },
        limit: { type: "integer" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "aws_docs_read",
    description: "Read one AWS documentation URL and return compact content.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        max_chars: { type: "integer" },
        start_index: { type: "integer" }
      },
      required: ["url"],
      additionalProperties: false
    }
  },
  {
    name: "aws_docs_evidence",
    description: "Search a question, read the top result, and return compact evidence for final answer generation by the client model.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        topics: { type: "array", items: { type: "string" } },
        search_limit: { type: "integer" },
        read_chars: { type: "integer" }
      },
      required: ["question"],
      additionalProperties: false
    }
  }
];

export class AwsDocsMcpServer {
  constructor({ service } = {}) {
    if (!service) {
      throw new Error("service is required");
    }
    this.service = service;
  }

  async handleJsonRpc(message) {
    if (!Object.hasOwn(message, "id")) {
      return undefined;
    }

    try {
      if (message.method === "initialize") {
        return this.success(message.id, {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "aws-docs-mcp-proxy", version: "0.1.0" }
        });
      }

      if (message.method === "tools/list") {
        return this.success(message.id, { tools: TOOL_DEFINITIONS });
      }

      if (message.method === "tools/call") {
        return await this.handleToolCall(message);
      }

      return this.error(message.id, -32601, `Unsupported method: ${message.method}`);
    } catch (error) {
      const code = error.message.includes("must be") || error.message.includes("Unsupported AWS documentation URL")
        ? -32602
        : -32000;
      return this.error(message.id, code, error.message);
    }
  }

  async handleToolCall(message) {
    const params = message.params;
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      return this.error(message.id, -32602, "tools/call params must be an object");
    }

    const args = params.arguments ?? {};
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      return this.error(message.id, -32602, "tools/call arguments must be an object");
    }

    let result;
    if (params.name === "aws_docs_search") {
      result = await this.service.search(args);
    } else if (params.name === "aws_docs_read") {
      result = await this.service.read(args);
    } else if (params.name === "aws_docs_evidence") {
      result = await this.service.evidence(args);
    } else {
      return this.error(message.id, -32602, `Unknown tool: ${params.name}`);
    }

    return this.success(message.id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: false
    });
  }

  success(id, result) {
    return { jsonrpc: "2.0", id, result };
  }

  error(id, code, message) {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcpServer.js test/mcpServer.test.js
git commit -m "feat: add local MCP server"
```

## Task 6: Stdio Entrypoint

**Files:**
- Create: `bin/aws-docs-mcp-proxy.js`
- Modify: `package.json`

- [ ] **Step 1: Create executable entrypoint**

Create `bin/aws-docs-mcp-proxy.js`:

```js
#!/usr/bin/env node

import readline from "node:readline";
import { AwsMcpClient } from "../src/awsMcpClient.js";
import { DocsEvidenceService } from "../src/docsEvidenceService.js";
import { AwsDocsMcpServer } from "../src/mcpServer.js";

async function main() {
  const client = new AwsMcpClient();
  await client.initialize();

  const service = new DocsEvidenceService({ client });
  const server = new AwsDocsMcpServer({ service });

  console.error("aws-docs-mcp-proxy ready");

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    let response;
    try {
      response = await server.handleJsonRpc(JSON.parse(line));
    } catch (error) {
      response = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: error.message }
      };
    }

    if (response !== undefined) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
}

main().catch((error) => {
  console.error(`aws-docs-mcp-proxy startup failed: ${error.message}`);
  if (error.message.includes("LoginRefreshRequired") || error.message.includes("session has expired")) {
    console.error("AWS MCP unavailable. Run aws login and retry.");
  }
  process.exit(1);
});
```

- [ ] **Step 2: Make entrypoint executable**

Run: `chmod +x bin/aws-docs-mcp-proxy.js`

Expected: command exits with code `0`.

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add bin/aws-docs-mcp-proxy.js package.json
git commit -m "feat: add stdio entrypoint"
```

## Task 7: Live Smoke Script

**Files:**
- Create: `scripts/smoke-live.js`
- Modify: `README.md`

- [ ] **Step 1: Create `scripts/smoke-live.js`**

```js
import { AwsMcpClient } from "../src/awsMcpClient.js";
import { DocsEvidenceService } from "../src/docsEvidenceService.js";

const question = process.argv.slice(2).join(" ") || "Amazon EBS use case";

const client = new AwsMcpClient();
await client.initialize();

const service = new DocsEvidenceService({ client });
const result = await service.evidence({ question });

console.log(JSON.stringify(result, null, 2));
```

- [ ] **Step 2: Verify unit tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run live smoke test if AWS authentication is available**

Run: `npm run smoke:live -- "Amazon EBS use case"`

Expected: output JSON contains `sources[0].url` from an AWS documentation or AWS site URL. If AWS authentication or network is unavailable, capture the error and do not change code only to satisfy the live test.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-live.js README.md
git commit -m "chore: add live smoke test"
```

## Task 8: Final Verification

**Files:**
- Modify if needed: `README.md`

- [ ] **Step 1: Run full unit test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Verify local tool catalog shape**

Run:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | ./bin/aws-docs-mcp-proxy.js
```

Expected: output contains exactly these public tool names:

```text
aws_docs_search
aws_docs_read
aws_docs_evidence
```

If AWS authentication is unavailable, the command should fail at startup with an actionable authentication message.

- [ ] **Step 3: Update README if verification reveals missing usage notes**

Only add concrete notes observed during verification, such as a required `aws login` step or a sample MCP config.

- [ ] **Step 4: Commit final docs if changed**

```bash
git add README.md
git commit -m "docs: clarify AWS docs proxy usage"
```

Skip this commit if README did not change.

## Self-Review Checklist

- Spec coverage: all spec components are covered by Tasks 2-7, and all success criteria are verified in Task 8.
- Placeholder scan: no `TBD`, `TODO`, or unspecified "add tests" steps remain.
- Type consistency: public tool names are `aws_docs_search`, `aws_docs_read`, and `aws_docs_evidence`; service method names are `search`, `read`, and `evidence`; AWS MCP canonical tool names are `aws___search_documentation` and `aws___read_documentation`.
- Scope check: this plan builds the docs-only MCP proxy and does not include answer generation, AWS CLI execution, resource mutation, or apfel-specific behavior.
