const DEFAULT_TTL_MS = 600_000;
const DEFAULT_MAX_ENTRIES = 200;

function normalizeQuery(query) {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

export function searchCacheKey({ query, topics, limit }) {
  const normalizedTopics = [...topics].sort().join(",");
  return `search:${normalizeQuery(query)}:${normalizedTopics}:${limit}`;
}

export function readCacheKey({ url, max_chars: maxChars, start_index: startIndex }) {
  const index = Number.isInteger(startIndex) && startIndex >= 0 ? startIndex : 0;
  return `read:${url}:${maxChars}:${index}`;
}

export function resolveCacheTtlMs() {
  const raw = process.env.AWS_DOCS_CACHE_TTL_MS;
  if (raw === undefined) {
    return DEFAULT_TTL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`aws-docs-mcp-proxy: invalid AWS_DOCS_CACHE_TTL_MS=${raw}, using default`);
    return DEFAULT_TTL_MS;
  }
  return parsed;
}

export class DocCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (this.now() - entry.at > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    this.store.set(key, { value, at: this.now() });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
  }
}
