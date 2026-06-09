import fs from "node:fs/promises";
import path from "node:path";

export async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

export function hasAwsDocs(data) {
  return Boolean(data?.mcpServers?.aws_docs);
}

export function mergeAwsDocsJson(data, command) {
  const next = structuredClone(data ?? {});
  if (!next.mcpServers) next.mcpServers = {};
  const existing = next.mcpServers.aws_docs ?? {};
  next.mcpServers.aws_docs = { ...existing, command };
  return next;
}

export async function writeJsonWithBackup(filePath, data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${filePath}.bak.${stamp}`;
  await fs.copyFile(filePath, backup);
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return backup;
}

export async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}
