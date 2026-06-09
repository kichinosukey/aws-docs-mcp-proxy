import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const SHARE_ROOT = path.join(HOME, ".local/share/aws-docs-mcp-proxy");

export function commandPath() {
  return path.join(HOME, ".local/bin/aws-docs-mcp-proxy");
}

export function installPaths(version) {
  return {
    shareRoot: SHARE_ROOT,
    versionDir: path.join(SHARE_ROOT, version),
    currentLink: path.join(SHARE_ROOT, "current"),
    binLink: commandPath(),
    binTarget: path.join(SHARE_ROOT, "current/bin/aws-docs-mcp-proxy.js")
  };
}

export const CLIENT_CONFIGS = {
  cursor: path.join(HOME, ".cursor/mcp.json"),
  claude: path.join(HOME, ".claude.json"),
  codex: path.join(HOME, ".codex/config.toml")
};
