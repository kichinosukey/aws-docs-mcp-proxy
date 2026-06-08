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
