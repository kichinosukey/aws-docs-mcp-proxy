import { AwsMcpClient } from "../src/awsMcpClient.js";
import { DocsEvidenceService } from "../src/docsEvidenceService.js";
import { AwsDocsMcpServer } from "../src/mcpServer.js";
import { compressSearchResult, compressReadResult } from "../src/resultCompressor.js";

const PROXY_TOOL_COUNT = 3;

function approxTokens(charCount) {
  return Math.ceil(charCount / 4);
}

function reductionPct(small, large) {
  return large > 0 ? Math.round((1 - small / large) * 100) : 0;
}

function emptyService() {
  return {
    async search() {
      return { results: [], notes: [] };
    },
    async read() {
      return { title: "", url: "", content: "", truncated: false, next_start_index: null, notes: [] };
    },
    async evidence() {
      return { question: "", sources: [], notes: [] };
    }
  };
}

async function proxyToolCatalogChars() {
  const server = new AwsDocsMcpServer({ service: emptyService() });
  const response = await server.handleJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list"
  });
  return JSON.stringify(response.result.tools).length;
}

async function main() {
  const query = process.argv.slice(2).join(" ") || "Amazon EBS use case";

  const client = new AwsMcpClient();
  await client.initialize();

  const toolsResult = await client.request("tools/list", {});
  const tools = toolsResult.tools ?? [];
  const toolsJson = JSON.stringify(tools);

  const rawSearch = await client.callTool("aws___search_documentation", {
    search_phrase: query,
    topics: ["general"],
    limit: 3
  });
  const rawSearchText = rawSearch.content?.[0]?.text ?? "";
  const compactSearchText = JSON.stringify(compressSearchResult(rawSearch, { limit: 3 }));

  const parsed = JSON.parse(rawSearchText);
  const topUrl = parsed?.content?.result?.[0]?.url;

  let readResponse = null;
  if (topUrl) {
    const rawRead = await client.callTool("aws___read_documentation", {
      requests: [{ url: topUrl, max_length: 10000 }]
    });
    const rawReadText = rawRead.content?.[0]?.text ?? "";
    const compactReadText = JSON.stringify(compressReadResult(rawRead, { maxChars: 4000 }));
    readResponse = {
      url: topUrl,
      raw_chars: rawReadText.length,
      compact_chars: compactReadText.length,
      reduction_pct: reductionPct(compactReadText.length, rawReadText.length)
    };
  }

  const service = new DocsEvidenceService({ client });
  const evidence = await service.evidence({ question: query });
  const evidenceText = JSON.stringify(evidence);

  const proxyCatalogChars = await proxyToolCatalogChars();
  const rawPerQuestionChars = rawSearchText.length + (readResponse?.raw_chars ?? 0);

  const summary = {
    measured_at: new Date().toISOString().slice(0, 10),
    query,
    tool_catalog: {
      full_aws_mcp: {
        tools: tools.length,
        chars: toolsJson.length,
        approx_tokens: approxTokens(toolsJson.length)
      },
      this_proxy: {
        tools: PROXY_TOOL_COUNT,
        chars: proxyCatalogChars,
        approx_tokens: approxTokens(proxyCatalogChars)
      },
      reduction_pct: reductionPct(proxyCatalogChars, toolsJson.length)
    },
    search_response: {
      raw_chars: rawSearchText.length,
      compact_chars: compactSearchText.length,
      reduction_pct: reductionPct(compactSearchText.length, rawSearchText.length)
    },
    read_response: readResponse,
    evidence_one_shot: {
      chars: evidenceText.length,
      approx_tokens: approxTokens(evidenceText.length)
    },
    per_question: {
      full_aws_mcp_search_plus_read_chars: rawPerQuestionChars,
      full_aws_mcp_approx_tokens: approxTokens(rawPerQuestionChars),
      proxy_evidence_chars: evidenceText.length,
      proxy_evidence_approx_tokens: approxTokens(evidenceText.length),
      reduction_pct: reductionPct(evidenceText.length, rawPerQuestionChars)
    }
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  const message = String(error?.message ?? error);
  if (message.includes("HTTP 401") || message.includes("HTTP 403") || message.toLowerCase().includes("auth")) {
    console.error("Benchmark failed: AWS authentication required. Run `aws login` and retry.");
  } else {
    console.error(`Benchmark failed: ${message}`);
  }
  process.exit(1);
});
