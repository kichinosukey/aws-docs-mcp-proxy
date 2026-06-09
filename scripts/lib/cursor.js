import fs from "node:fs/promises";
import { CLIENT_CONFIGS } from "./paths.js";
import { hasAwsDocs, mergeAwsDocsJson, readJsonFile, writeJsonWithBackup, ensureParentDir } from "./jsonClient.js";
import { confirmOverwrite } from "./prompt.js";

export const name = "cursor";
export const configPath = CLIENT_CONFIGS.cursor;

export async function configure({ command, dryRun, assumeYes }) {
  const exists = await fs.access(configPath).then(() => true, () => false);
  if (!exists) {
    return { status: "skipped", reason: "config not found" };
  }

  let data;
  try {
    data = await readJsonFile(configPath);
  } catch (error) {
    return { status: "failed", reason: `invalid JSON: ${error.message}` };
  }

  if (hasAwsDocs(data)) {
    const ok = await confirmOverwrite(`${name}: aws_docs is already configured. Overwrite?`, { assumeYes });
    if (!ok) return { status: "skipped", reason: "user declined overwrite" };
  }

  const next = mergeAwsDocsJson(data, command);
  if (dryRun) {
    return { status: "dry-run", configPath, next };
  }

  if (hasAwsDocs(data)) {
    await writeJsonWithBackup(configPath, next);
  } else {
    await ensureParentDir(configPath);
    await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }

  return { status: "updated", configPath };
}
