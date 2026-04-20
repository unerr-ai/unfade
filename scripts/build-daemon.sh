#!/usr/bin/env bash
# Cross-compile unfaded + unfade-send for all supported platforms.
# Outputs to packages/daemon-{platform}-{npm-arch}/bin/ (npm cpu naming: x64 not amd64).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DAEMON_DIR="$ROOT/daemon"

export CGO_ENABLED=0

if [[ ! -f "$DAEMON_DIR/go.mod" ]]; then
  echo "error: $DAEMON_DIR/go.mod not found" >&2
  exit 1
fi

cd "$DAEMON_DIR"

target_pkg_dir() {
  local goos="$1"
  local goarch="$2"
  case "${goos}/${goarch}" in
    darwin/arm64) echo "$ROOT/packages/daemon-darwin-arm64" ;;
    darwin/amd64) echo "$ROOT/packages/daemon-darwin-x64" ;;
    linux/arm64) echo "$ROOT/packages/daemon-linux-arm64" ;;
    linux/amd64) echo "$ROOT/packages/daemon-linux-x64" ;;
    *)
      echo "error: unsupported target ${goos}/${goarch}" >&2
      exit 1
      ;;
  esac
}

for target in "darwin/arm64" "darwin/amd64" "linux/arm64" "linux/amd64"; do
  GOOS="${target%%/*}"
  GOARCH="${target##*/}"
  pkg_dir="$(target_pkg_dir "$GOOS" "$GOARCH")"
  outdir="${pkg_dir}/bin"
  mkdir -p "$outdir"
  echo "Building ${GOOS}/${GOARCH} -> ${outdir}"
  GOOS="$GOOS" GOARCH="$GOARCH" go build -trimpath -ldflags="-s -w" -o "${outdir}/unfaded" ./cmd/unfaded
  GOOS="$GOOS" GOARCH="$GOARCH" go build -trimpath -ldflags="-s -w" -o "${outdir}/unfade-send" ./cmd/unfade-send
done

# Executable bits for Unix artifacts (local dev / copied trees)
chmod +x "$ROOT"/packages/daemon-*/bin/unfaded "$ROOT"/packages/daemon-*/bin/unfade-send 2>/dev/null || true

echo "Daemon binaries built under packages/*/bin/"
