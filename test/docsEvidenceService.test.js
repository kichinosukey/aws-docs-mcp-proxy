import test from "node:test";
import assert from "node:assert/strict";
import { DocsEvidenceService } from "../src/docsEvidenceService.js";
import { DocCache } from "../src/docCache.js";

function makeSearchPayload(rows) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ content: { result: rows } })
    }]
  };
}

function makeReadPayload(content, url = "https://docs.aws.amazon.com/example") {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        content: {
          result: [{
            status: "SUCCESS",
            url,
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
        return makeReadPayload(
          "# Fargate\n\nAWS Fargate runs containers without managing servers. You specify CPU and memory.",
          args.requests[0].url
        );
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

test("search returns timing_ms and uses cache on second call", async () => {
  let calls = 0;
  const cache = new DocCache({ ttlMs: 60_000 });
  const service = new DocsEvidenceService({
    cache,
    client: {
      async callTool(name) {
        calls += 1;
        assert.equal(name, "aws___search_documentation");
        return makeSearchPayload([{ rank_order: 1, title: "EBS", url: "https://docs.aws.amazon.com/ebs", context: "Block storage." }]);
      }
    }
  });

  const first = await service.search({ query: "Amazon EBS use case" });
  assert.ok(first.timing_ms);
  assert.equal(typeof first.timing_ms.total, "number");
  assert.equal(first.timing_ms.cache.search_hit, false);
  assert.equal(calls, 1);

  const second = await service.search({ query: "Amazon EBS use case" });
  assert.equal(second.timing_ms.cache.search_hit, true);
  assert.equal(calls, 1);
  assert.deepEqual(second.results, first.results);
});

test("evidence returns timing_ms with search and read sub-phases", async () => {
  const cache = new DocCache({ ttlMs: 60_000 });
  const service = new DocsEvidenceService({
    cache,
    client: {
      async callTool(name, args) {
        if (name === "aws___search_documentation") {
          return makeSearchPayload([{ rank_order: 1, title: "Fargate", url: "https://docs.aws.amazon.com/ecs/fargate", context: "Serverless compute." }]);
        }
        return makeReadPayload("AWS Fargate content.", args.requests[0].url);
      }
    }
  });

  const result = await service.evidence({ question: "What is Fargate?" });
  assert.equal(typeof result.timing_ms.total, "number");
  assert.equal(typeof result.timing_ms.search, "number");
  assert.equal(typeof result.timing_ms.read, "number");
  assert.equal(result.timing_ms.cache.search_hit, false);
  assert.equal(result.timing_ms.cache.read_hit, false);
});
