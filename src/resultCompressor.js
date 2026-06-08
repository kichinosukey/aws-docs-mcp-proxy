export function truncateText(text, maxLength = 360) {
  if (typeof text !== "string") {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function textContent(result) {
  return result?.content?.find?.((item) => item.type === "text")?.text;
}

function parseAwsTextPayload(result) {
  const text = textContent(result);
  if (typeof text !== "string") {
    throw new Error("AWS MCP result did not contain text content");
  }
  return JSON.parse(text);
}

function sourceType(row) {
  if (row.skill_name) {
    return "skill";
  }
  if (typeof row.url === "string" && row.url.includes("docs.aws.amazon.com")) {
    return "documentation";
  }
  return "aws_site";
}

export function compressSearchResult(result, { limit = 3, contextChars = 360 } = {}) {
  try {
    const parsed = parseAwsTextPayload(result);
    const rows = parsed?.content?.result;

    if (!Array.isArray(rows)) {
      return { results: [], notes: ["AWS MCP search payload did not contain result rows."] };
    }

    return {
      results: rows.slice(0, limit).map((row, index) => ({
        rank: row.rank_order ?? index + 1,
        title: row.title ?? "",
        url: row.url ?? "",
        context: truncateText(row.context ?? row.skill_description ?? "", contextChars),
        source_type: sourceType(row)
      })),
      notes: []
    };
  } catch (error) {
    return { results: [], notes: [`Failed to parse AWS MCP search result: ${error.message}`] };
  }
}

function stripToc(content) {
  const withoutToc = content
    .replace(/Table of Contents:\n(?:\s*- .*\n)+\n?/m, "")
    .replace(/^Note: Page redirected.*\n\n/m, "")
    .trim();
  const firstHeading = withoutToc.search(/^#\s+/m);
  return firstHeading > 0 ? withoutToc.slice(firstHeading).trim() : withoutToc;
}

function titleFromContent(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

export function compressReadResult(result, { maxChars = 4000 } = {}) {
  try {
    const parsed = parseAwsTextPayload(result);
    const row = parsed?.content?.result?.[0];

    if (!row || row.status !== "SUCCESS") {
      return {
        title: "",
        url: row?.url ?? "",
        content: "",
        truncated: false,
        next_start_index: null,
        notes: [`AWS MCP read failed with status: ${row?.status ?? "missing"}`]
      };
    }

    const stripped = stripToc(row.content ?? "");

    return {
      title: titleFromContent(stripped),
      url: row.redirected_url ?? row.url ?? "",
      content: truncateText(stripped.replace(/^#\s+.+\n+/, ""), maxChars),
      truncated: row.truncated === true,
      next_start_index: row.truncated === true ? row.end_index ?? null : null,
      notes: []
    };
  } catch (error) {
    return {
      title: "",
      url: "",
      content: "",
      truncated: false,
      next_start_index: null,
      notes: [`Failed to parse AWS MCP read result: ${error.message}`]
    };
  }
}

export function extractEvidencePoints(content, limit = 3) {
  return String(content)
    .split(/(?<=[.。])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => truncateText(item, 220));
}
