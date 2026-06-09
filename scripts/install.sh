#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="kichinosukey/aws-docs-mcp-proxy"
HOME="${HOME:-$(
  cd ~ && pwd
)}"
SHARE_ROOT="$HOME/.local/share/aws-docs-mcp-proxy"
LOCAL_BIN="$HOME/.local/bin"
DOWNLOADED_TARBALL=""

die() {
  echo "error: $*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$DOWNLOADED_TARBALL" && -f "$DOWNLOADED_TARBALL" ]]; then
    rm -f "$DOWNLOADED_TARBALL"
  fi
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed"
}

check_node_version() {
  require_command node
  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if (( major < 20 )); then
    die "Node.js 20 or newer is required (found $(node -v)). Install from https://nodejs.org/"
  fi
}

resolve_release() {
  if [[ "${AWS_DOCS_INSTALL_SOURCE:-}" == "local" ]]; then
    [[ -n "${INSTALL_TARBALL:-}" ]] || die "INSTALL_TARBALL must be set when AWS_DOCS_INSTALL_SOURCE=local"
    [[ -f "$INSTALL_TARBALL" ]] || die "INSTALL_TARBALL not found: $INSTALL_TARBALL"
    TARBALL_PATH="$(cd "$(dirname "$INSTALL_TARBALL")" && pwd)/$(basename "$INSTALL_TARBALL")"
    local base
    base="$(basename "$TARBALL_PATH" .tar.gz)"
    VERSION="${base#aws-docs-mcp-proxy-}"
    [[ -n "$VERSION" && "$VERSION" != "$base" ]] || die "could not parse version from tarball name: $TARBALL_PATH"
    return
  fi

  require_command curl
  local release_json tag
  release_json="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")" ||
    die "failed to fetch latest release from GitHub; check your network and retry"
  tag="$(node -p "JSON.parse(process.argv[1]).tag_name" "$release_json")"
  [[ -n "$tag" ]] || die "could not determine release tag from GitHub API response"
  VERSION="${tag#v}"
  local tarball_name="aws-docs-mcp-proxy-${VERSION}.tar.gz"
  local url="https://github.com/$REPO/releases/download/${tag}/${tarball_name}"
  DOWNLOADED_TARBALL="$(mktemp "${TMPDIR:-/tmp}/aws-docs-mcp-proxy.XXXXXX.tar.gz")"
  curl -fsSL -o "$DOWNLOADED_TARBALL" "$url" ||
    die "failed to download ${url}; check your network and retry"
  TARBALL_PATH="$DOWNLOADED_TARBALL"
}

extract_release() {
  local version_dir="$SHARE_ROOT/$VERSION"
  local extracted_dir="$SHARE_ROOT/aws-docs-mcp-proxy-$VERSION"

  rm -rf "$version_dir" "$extracted_dir"
  mkdir -p "$SHARE_ROOT"

  if ! tar -xzf "$TARBALL_PATH" -C "$SHARE_ROOT"; then
    rm -rf "$version_dir" "$extracted_dir"
    die "failed to extract release tarball"
  fi

  if [[ ! -d "$extracted_dir" ]]; then
    rm -rf "$version_dir" "$extracted_dir"
    die "release tarball did not contain aws-docs-mcp-proxy-$VERSION/"
  fi

  mv "$extracted_dir" "$version_dir"
}

link_install() {
  ln -sfn "$VERSION" "$SHARE_ROOT/current"
  mkdir -p "$LOCAL_BIN"
  ln -sfn "../share/aws-docs-mcp-proxy/current/bin/aws-docs-mcp-proxy.js" "$LOCAL_BIN/aws-docs-mcp-proxy"
}

warn_path() {
  case ":$PATH:" in
    *":$LOCAL_BIN:"*) ;;
    *)
      echo "warning: $LOCAL_BIN is not in PATH"
      echo "Add it with: export PATH=\"$LOCAL_BIN:\$PATH\""
      ;;
  esac
}

is_dry_run() {
  for arg in "$@"; do
    if [[ "$arg" == "--dry-run" ]]; then
      return 0
    fi
  done
  return 1
}

has_clients_flag() {
  for arg in "$@"; do
    if [[ "$arg" == "--clients" ]]; then
      return 0
    fi
  done
  return 1
}

print_configure_hint() {
  local configure_js="$SHARE_ROOT/current/scripts/configure-clients.js"
  echo ""
  echo "Binary installed. Configure one MCP client (pick the agent you use):"
  echo "  node \"$configure_js\" --clients cursor"
  echo "  node \"$configure_js\" --clients codex"
  echo "  node \"$configure_js\" --clients claude"
  echo ""
  echo "Or re-run the installer with --clients, for example:"
  echo "  curl -fsSL https://github.com/$REPO/releases/latest/download/install.sh | bash -s -- --clients cursor"
}

main() {
  check_node_version

  if is_dry_run "$@"; then
    if ! has_clients_flag "$@"; then
      die "--dry-run requires --clients <name> (cursor, codex, or claude)"
    fi
    echo "Dry run: skipped download and install; showing config changes only."
    node "$SCRIPT_DIR/configure-clients.js" "$@"
    exit 0
  fi

  require_command tar
  if [[ "${AWS_DOCS_INSTALL_SOURCE:-}" != "local" ]]; then
    require_command curl
  fi

  resolve_release
  extract_release
  link_install
  warn_path

  if has_clients_flag "$@"; then
    node "$SHARE_ROOT/current/scripts/configure-clients.js" "$@"
  else
    print_configure_hint
  fi
}

main "$@"
