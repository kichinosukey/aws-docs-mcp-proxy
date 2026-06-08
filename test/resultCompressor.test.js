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
            content: "# Title\n\nTable of Contents:\n- A\n\nUseful content here.",
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

test("compressReadResult strips nested table of contents blocks", () => {
  const result = compressReadResult({
    content: [{
      type: "text",
      text: JSON.stringify({
        content: {
          result: [{
            status: "SUCCESS",
            url: "https://aws.amazon.com/ebs/",
            content: "# Amazon Elastic Block Store\n\nTable of Contents:\n- What is Amazon EBS? (char 571-1162)\n  - Benefits of Amazon EBS (char 1163-2507)\n    - Scale fast (char 1190-1355)\n\nAmazon EBS is block storage for EC2.",
            truncated: false
          }]
        }
      })
    }]
  });

  assert.equal(result.content, "Amazon EBS is block storage for EC2.");
});

test("compressReadResult strips leading navigation before the first heading", () => {
  const result = compressReadResult({
    content: [{
      type: "text",
      text: JSON.stringify({
        content: {
          result: [{
            status: "SUCCESS",
            url: "https://aws.amazon.com/ebs/",
            content: "Amazon Elastic Block Store\n\n* [Overview](/ebs/)\n* Features\n\n# Amazon Elastic Block Store\n\nEasy to use block storage.",
            truncated: false
          }]
        }
      })
    }]
  });

  assert.equal(result.title, "Amazon Elastic Block Store");
  assert.equal(result.content, "Easy to use block storage.");
});

test("extractEvidencePoints returns short lines", () => {
  const points = extractEvidencePoints("First useful sentence. Second useful sentence. Third useful sentence.", 2);
  assert.deepEqual(points, ["First useful sentence.", "Second useful sentence."]);
});
