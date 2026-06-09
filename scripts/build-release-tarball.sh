#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/package.json','utf8')).version")}"
STAGE="$ROOT/.release/aws-docs-mcp-proxy-$VERSION"

rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$ROOT/bin" "$ROOT/src" "$ROOT/scripts" "$ROOT/package.json" "$ROOT/LICENSE" "$STAGE/"
echo "$VERSION" > "$STAGE/VERSION"

mkdir -p "$ROOT/.release"
tar -czf "$ROOT/.release/aws-docs-mcp-proxy-$VERSION.tar.gz" -C "$ROOT/.release" "aws-docs-mcp-proxy-$VERSION"
echo "Created $ROOT/.release/aws-docs-mcp-proxy-$VERSION.tar.gz"
