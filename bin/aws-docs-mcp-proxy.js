#!/usr/bin/env node

import readline from "node:readline";
import { AwsMcpClient } from "../src/awsMcpClient.js";
import { DocCache, resolveCacheTtlMs } from "../src/docCache.js";
import { DocsEvidenceService } from "../src/docsEvidenceService.js";
import { AwsDocsMcpServer } from "../src/mcpServer.js";

async function main() {
  const client = new AwsMcpClient();
  await client.initialize();

  const cache = new DocCache({ ttlMs: resolveCacheTtlMs() });
  const service = new DocsEvidenceService({ client, cache });
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
