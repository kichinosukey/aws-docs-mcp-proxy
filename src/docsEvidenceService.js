import {
  compressSearchResult,
  compressReadResult,
  extractEvidencePoints,
  truncateText
} from "./resultCompressor.js";

const DEFAULT_TOPICS = ["general"];
const MAX_SEARCH_LIMIT = 5;
const MAX_READ_CHARS = 8000;

function ensureString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeTopics(topics) {
  if (topics === undefined) {
    return DEFAULT_TOPICS;
  }
  if (!Array.isArray(topics) || topics.some((topic) => typeof topic !== "string")) {
    throw new Error("topics must be an array of strings");
  }
  return topics.length === 0 ? DEFAULT_TOPICS : topics;
}

function clampInteger(value, defaultValue, maxValue) {
  if (!Number.isInteger(value)) {
    return defaultValue;
  }
  return Math.min(Math.max(value, 1), maxValue);
}

export function isAllowedAwsDocsUrl(url) {
  try {
    const parsed = new URL(url);
    return [
      "docs.aws.amazon.com",
      "aws.amazon.com",
      "repost.aws",
      "docs.amplify.aws",
      "ui.docs.amplify.aws",
      "strandsagents.com"
    ].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export class DocsEvidenceService {
  constructor({ client } = {}) {
    if (!client) {
      throw new Error("client is required");
    }
    this.client = client;
  }

  async search({ query, topics, limit } = {}) {
    const searchPhrase = ensureString(query, "query");
    const normalizedTopics = normalizeTopics(topics);
    const normalizedLimit = clampInteger(limit, 3, MAX_SEARCH_LIMIT);

    const result = await this.client.callTool("aws___search_documentation", {
      search_phrase: searchPhrase,
      topics: normalizedTopics,
      limit: normalizedLimit
    });

    return compressSearchResult(result, { limit: normalizedLimit });
  }

  async read({ url, max_chars: maxChars, start_index: startIndex } = {}) {
    const normalizedUrl = ensureString(url, "url");
    if (!isAllowedAwsDocsUrl(normalizedUrl)) {
      throw new Error(`Unsupported AWS documentation URL: ${normalizedUrl}`);
    }

    const normalizedMaxChars = clampInteger(maxChars, 4000, MAX_READ_CHARS);
    const request = {
      url: normalizedUrl,
      max_length: normalizedMaxChars
    };

    if (Number.isInteger(startIndex) && startIndex >= 0) {
      request.start_index = startIndex;
    }

    const result = await this.client.callTool("aws___read_documentation", {
      requests: [request]
    });

    return compressReadResult(result, { maxChars: normalizedMaxChars });
  }

  async evidence({ question, topics, search_limit: searchLimit, read_chars: readChars } = {}) {
    const normalizedQuestion = ensureString(question, "question");
    const searchResult = await this.search({
      query: normalizedQuestion,
      topics,
      limit: clampInteger(searchLimit, 3, MAX_SEARCH_LIMIT)
    });

    const top = searchResult.results.find((row) => row.url && isAllowedAwsDocsUrl(row.url));
    const notes = [...searchResult.notes];

    if (!top) {
      notes.push("No readable AWS documentation URL found in search results.");
      return { question: normalizedQuestion, sources: [], notes };
    }

    try {
      const readResult = await this.read({
        url: top.url,
        max_chars: clampInteger(readChars, 4000, MAX_READ_CHARS)
      });
      notes.push(...readResult.notes);

      return {
        question: normalizedQuestion,
        sources: [{
          rank: top.rank,
          title: readResult.title || top.title,
          url: readResult.url || top.url,
          relevant_points: extractEvidencePoints(`${top.context} ${readResult.content}`, 3),
          excerpt: truncateText(readResult.content || top.context, 700)
        }],
        notes
      };
    } catch (error) {
      notes.push(`Read failed for ${top.url}: ${error.message}`);
      return {
        question: normalizedQuestion,
        sources: [{
          rank: top.rank,
          title: top.title,
          url: top.url,
          relevant_points: extractEvidencePoints(top.context, 3),
          excerpt: truncateText(top.context, 700)
        }],
        notes
      };
    }
  }
}
