import test from "node:test";
import assert from "node:assert/strict";
import {
  DocCache,
  searchCacheKey,
  readCacheKey,
  resolveCacheTtlMs
} from "../src/docCache.js";

test("searchCacheKey normalizes query and topics", () => {
  const key = searchCacheKey({
    query: "  Amazon   EBS  ",
    topics: ["General", "reference_documentation"],
    limit: 3
  });
  assert.equal(key, "search:amazon ebs:general,reference_documentation:3");
});

test("readCacheKey includes url max_chars start_index", () => {
  const key = readCacheKey({
    url: "https://docs.aws.amazon.com/x",
    max_chars: 4000,
    start_index: 0
  });
  assert.equal(key, "read:https://docs.aws.amazon.com/x:4000:0");
});

test("get returns undefined on miss", () => {
  const cache = new DocCache({ ttlMs: 60_000 });
  assert.equal(cache.get("missing"), undefined);
});

test("get returns value before TTL expires", () => {
  const cache = new DocCache({ ttlMs: 60_000 });
  cache.set("k", { ok: true });
  assert.deepEqual(cache.get("k"), { ok: true });
});

test("get returns undefined after TTL expires", () => {
  let now = 1_000;
  const cache = new DocCache({
    ttlMs: 100,
    now: () => now
  });
  cache.set("k", { ok: true });
  now += 101;
  assert.equal(cache.get("k"), undefined);
});

test("LRU evicts oldest entry when maxEntries exceeded", () => {
  const cache = new DocCache({ ttlMs: 60_000, maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.set("c", 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
});

test("resolveCacheTtlMs uses env when valid", () => {
  const prev = process.env.AWS_DOCS_CACHE_TTL_MS;
  process.env.AWS_DOCS_CACHE_TTL_MS = "5000";
  assert.equal(resolveCacheTtlMs(), 5000);
  if (prev === undefined) {
    delete process.env.AWS_DOCS_CACHE_TTL_MS;
  } else {
    process.env.AWS_DOCS_CACHE_TTL_MS = prev;
  }
});

test("resolveCacheTtlMs falls back to default on invalid env", () => {
  const prev = process.env.AWS_DOCS_CACHE_TTL_MS;
  process.env.AWS_DOCS_CACHE_TTL_MS = "not-a-number";
  assert.equal(resolveCacheTtlMs(), 600_000);
  if (prev === undefined) {
    delete process.env.AWS_DOCS_CACHE_TTL_MS;
  } else {
    process.env.AWS_DOCS_CACHE_TTL_MS = prev;
  }
});
