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
