import fs from "node:fs/promises";
import path from "node:path";
import { CLIENT_CONFIGS } from "./paths.js";
import { confirmOverwrite } from "./prompt.js";

const AWS_DOCS_HEADER = "[mcp_servers.aws_docs]";

export const name = "codex";
export const configPath = CLIENT_CONFIGS.codex;

export function hasAwsDocsToml(text) {
  return text.includes(AWS_DOCS_HEADER);
}

function escapeTomlString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function upsertAwsDocsCommand(text, command) {
  const escaped = escapeTomlString(command);
  const commandLine = `command = "${escaped}"`;

  if (!hasAwsDocsToml(text)) {
    const suffix = text.endsWith("\n") ? "" : "\n";
    return `${text}${suffix}\n${AWS_DOCS_HEADER}\n${commandLine}\n`;
  }

  const lines = text.split("\n");
  const headerIndex = lines.findIndex((line) => line.trim() === AWS_DOCS_HEADER);
  if (headerIndex === -1) {
    throw new Error("aws_docs header found but not on its own line");
  }

  let endIndex = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("[") && !line.startsWith("[mcp_servers.aws_docs.")) {
      endIndex = i;
      break;
    }
  }

  const block = lines.slice(headerIndex + 1, endIndex);
  const commandIdx = block.findIndex((line) => line.trim().startsWith("command"));
  if (commandIdx === -1) {
    block.unshift(commandLine);
  } else {
    block[commandIdx] = commandLine;
  }

  const rebuilt = [
    ...lines.slice(0, headerIndex + 1),
    ...block,
    ...lines.slice(endIndex)
  ];
  return `${rebuilt.join("\n").replace(/\n*$/, "\n")}`;
}

export async function configure({ command, dryRun, assumeYes }) {
  const exists = await fs.access(configPath).then(() => true, () => false);
  if (!exists) {
    return { status: "skipped", reason: "config not found" };
  }

  let text;
  try {
    text = await fs.readFile(configPath, "utf8");
  } catch (error) {
    return { status: "failed", reason: error.message };
  }

  if (hasAwsDocsToml(text)) {
    const ok = await confirmOverwrite(`${name}: aws_docs is already configured. Overwrite?`, { assumeYes });
    if (!ok) return { status: "skipped", reason: "user declined overwrite" };
  }

  const next = upsertAwsDocsCommand(text, command);
  if (dryRun) {
    return { status: "dry-run", configPath, next };
  }

  if (hasAwsDocsToml(text)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.copyFile(configPath, `${configPath}.bak.${stamp}`);
  } else {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
  }

  await fs.writeFile(configPath, next, "utf8");
  return { status: "updated", configPath };
}
