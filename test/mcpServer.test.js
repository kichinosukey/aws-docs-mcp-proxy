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
