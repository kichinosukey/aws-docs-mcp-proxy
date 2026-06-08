import test from "node:test";
import assert from "node:assert/strict";
import { parseAwsMcpResponse, AwsMcpClient } from "../src/awsMcpClient.js";

test("parseAwsMcpResponse parses plain JSON", () => {
  const message = parseAwsMcpResponse('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
  assert.deepEqual(message, { jsonrpc: "2.0", id: 1, result: { ok: true } });
});

test("parseAwsMcpResponse parses JSON-RPC from SSE frames", () => {
  const message = parseAwsMcpResponse('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n');
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
