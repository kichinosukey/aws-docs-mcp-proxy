# Frictionless Install for aws-docs-mcp-proxy

**Date:** 2026-06-09  
**Status:** Approved (brainstorming)  
**Scope:** v1 — GitHub Releases distribution with one-command install and multi-client MCP auto-configuration

## Problem

Today, installing `aws-docs-mcp-proxy` requires:

1. `git clone` the repository
2. Manually editing MCP client config with an absolute path to `bin/aws-docs-mcp-proxy.js`
3. Knowing each client's config file location and format

This blocks casual users and creates support friction. The MCP server itself works; the install experience does not.

## Goals

- New users run **one command** to install the server and configure supported MCP clients.
- Support **Cursor**, **Codex**, and **Claude Code** (global config) in v1.
- Do **not** break existing MCP server entries; only add or update `aws_docs`.
- When `aws_docs` already exists, **prompt before overwrite** (interactive default).

## Non-Goals (v1)

- Windows support
- Automatic `aws login` or credential setup
- Automatic Node.js installation
- npm registry publishing
- Cursor Marketplace / deeplink registration
- Uninstall command (v1.1 candidate)
- Project-local MCP config (`.cursor/mcp.json`, project `.mcp.json`) — global only

## Prerequisites (documented, not automated)

- **Node.js 20+** (required to run the stdio MCP server)
- **`aws login`** completed (required to reach the remote AWS MCP endpoint)
- **macOS or Linux** (v1 platform scope)
- **`curl`** (for the install script)

## User Experience

### Install

```sh
curl -fsSL https://github.com/kichinosukey/aws-docs-mcp-proxy/releases/latest/download/install.sh | bash
```

The script:

1. Verifies Node.js 20+
2. Downloads the latest release tarball from GitHub Releases
3. Extracts to `~/.local/share/aws-docs-mcp-proxy/<version>/`
4. Updates symlinks (`current` and `~/.local/bin/aws-docs-mcp-proxy`)
5. Runs `configure-clients.js` to update detected MCP client configs
6. Prints a summary and asks the user to restart their MCP clients

### Upgrade

Re-run the same `install.sh` command. New version is extracted; symlinks updated. Existing `aws_docs` config triggers the overwrite prompt again unless `--yes` is passed.

### Success Criteria

- No `git clone` or manual path editing required
- `aws-docs-mcp-proxy` is invocable from `~/.local/bin/`
- At least one of Cursor / Codex / Claude Code has a working `aws_docs` entry after install
- Other MCP servers in the same config files remain untouched

## Architecture

### Recommended Approach

**`install.sh` (thin bootstrap) + `configure-clients.js` (config merger)**

Rejected alternatives:

- **bash-only installer (jq + heredoc):** fragile for Codex TOML merge and existing-config detection
- **npm publish:** not chosen; distribution is GitHub Releases only

### Installed Layout

```
~/.local/
├── bin/
│   └── aws-docs-mcp-proxy          → ../share/aws-docs-mcp-proxy/current/bin/aws-docs-mcp-proxy.js
└── share/aws-docs-mcp-proxy/
    ├── current                       → <version>/
    └── <version>/
        ├── bin/aws-docs-mcp-proxy.js
        ├── src/
        ├── package.json
        └── VERSION
```

Versioned directories enable rollback by repointing the `current` symlink.

### Repository Additions

| File | Role |
|------|------|
| `scripts/install.sh` | Entry point: OS check, release fetch, extract, symlinks, invoke configure |
| `scripts/configure-clients.js` | Detect clients, merge config, interactive overwrite prompt |
| `scripts/lib/paths.js` | Install path constants |
| `scripts/lib/cursor.js` | Read/write `~/.cursor/mcp.json` |
| `scripts/lib/claude.js` | Read/write `~/.claude.json` `mcpServers` |
| `scripts/lib/codex.js` | Read/write `~/.codex/config.toml` `[mcp_servers.aws_docs]` |
| `.github/workflows/release.yml` | Build tarball and attach to GitHub Release on tag push |

The MCP server runtime remains dependency-free (Node built-ins only). The configure script may use a lightweight TOML parser for safe Codex merging; if avoided, Codex updates use block-level replace with tests guarding correctness.

### Component Flow

```
User → install.sh → GitHub Release (tarball)
                 → ~/.local/share/aws-docs-mcp-proxy/<version>/
                 → configure-clients.js
                      → ~/.cursor/mcp.json
                      → ~/.codex/config.toml
                      → ~/.claude.json
                 → MCP clients launch ~/.local/bin/aws-docs-mcp-proxy
                      → existing stdio MCP server → AWS MCP endpoint
```

## Client Configuration

### Server Name

`aws_docs` (consistent across all clients; matches existing README examples)

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "aws_docs": {
      "command": "/Users/<user>/.local/bin/aws-docs-mcp-proxy"
    }
  }
}
```

### Claude Code (`~/.claude.json`)

Same JSON shape as Cursor (`mcpServers.aws_docs`).

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.aws_docs]
command = "/Users/<user>/.local/bin/aws-docs-mcp-proxy"
```

On overwrite, preserve user-added fields (e.g. `approval_mode`, tool-level settings) where possible.

The `command` path uses the `~/.local/bin` symlink resolved to an absolute path at configure time. The bin entry has `#!/usr/bin/env node`, so no `args` are required.

## Configure Script Behavior

1. **Detect** which config files exist
2. **Check** for existing `aws_docs` entry
3. **Prompt** if existing: `aws_docs is already configured. Overwrite? [y/N]`
4. **Backup** before overwrite: `<config-file>.bak.<timestamp>` in the same directory
5. **Merge** only the `aws_docs` entry; leave all other servers unchanged
6. **Report** which clients were updated, skipped, or failed

### CLI Flags

```
install.sh [--dry-run] [--yes] [--clients cursor,codex,claude]
```

| Flag | Purpose |
|------|---------|
| `--dry-run` | Show planned changes without writing |
| `--yes` | Skip overwrite prompts (overwrite existing `aws_docs`) |
| `--clients` | Limit to specific clients (comma-separated) |

## GitHub Release Artifacts

On tag push (e.g. `v0.2.0`):

- `aws-docs-mcp-proxy-<version>.tar.gz` containing `bin/`, `src/`, `package.json`, `LICENSE`, `VERSION`
- `install.sh` attached to the same release (served at `releases/latest/download/install.sh`)

`install.sh` resolves the tarball URL via GitHub API (`/repos/kichinosukey/aws-docs-mcp-proxy/releases/latest`).

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Node.js < 20 or missing | Exit 1 with install instructions |
| Network / curl failure | Exit 1 with retry guidance |
| Tarball extract failure | Remove partial directory, exit 1 |
| Malformed client config | Skip that client, print manual fix steps, continue others |
| Existing `aws_docs` + user answers `n` | Skip that client |
| `~/.local/bin` not in PATH | Warn; show `export PATH=...` example; install still completes |
| Permission denied on write | Exit 1 with path details |

**Principle:** one client failure does not abort the entire install.

## Testing

| Layer | Coverage |
|-------|----------|
| Unit | JSON/TOML merge, existing-entry detection, backup creation (temp dirs) |
| Integration | Fixture configs → run configure → assert expected diff |
| CI | Release workflow builds tarball; `install.sh --dry-run` on ubuntu + macos |
| Manual | Existing `npm run smoke:live` for MCP server; local install smoke on real configs |

## README Changes

Replace current Quick start with the one-line `curl | bash` install.

Move `git clone` + manual `mcp.json` instructions to **Advanced / Manual setup**.

## Open Implementation Notes

- Resolve absolute path for `command` using `os.homedir()` + `path.resolve`, not `~` literals (Codex/Cursor may not expand `~`).
- First tagged release (`v0.2.0` or next) is required before the install URL works.
- Consider `scripts/uninstall.sh` in v1.1 to remove symlinks and optionally config entries.
