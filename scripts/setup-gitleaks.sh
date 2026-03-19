#!/bin/sh
#
# Downloads the gitleaks binary to .bin/ if not already present.
# Called automatically by `npm run prepare` (via package.json).
#
# Supports Linux and macOS on x86_64 and arm64.
#

set -e

GITLEAKS_VERSION="8.24.2"
INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)/.bin"

# Skip if already installed and correct version
if [ -x "$INSTALL_DIR/gitleaks" ]; then
    CURRENT=$("$INSTALL_DIR/gitleaks" version 2>/dev/null || echo "unknown")
    if [ "$CURRENT" = "v$GITLEAKS_VERSION" ] || [ "$CURRENT" = "$GITLEAKS_VERSION" ]; then
        exit 0
    fi
    echo "Updating gitleaks from $CURRENT to v$GITLEAKS_VERSION..."
fi

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
    linux)  OS="linux" ;;
    darwin) OS="darwin" ;;
    *)
        echo "WARNING: Unsupported OS '$OS' — skipping gitleaks install."
        echo "         Install manually: https://github.com/gitleaks/gitleaks/releases"
        exit 0
        ;;
esac

case "$ARCH" in
    x86_64|amd64)  ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)
        echo "WARNING: Unsupported architecture '$ARCH' — skipping gitleaks install."
        echo "         Install manually: https://github.com/gitleaks/gitleaks/releases"
        exit 0
        ;;
esac

TARBALL="gitleaks_${GITLEAKS_VERSION}_${OS}_${ARCH}.tar.gz"
URL="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${TARBALL}"

mkdir -p "$INSTALL_DIR"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "Downloading gitleaks v${GITLEAKS_VERSION} for ${OS}/${ARCH}..."
if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$TMPDIR/$TARBALL"
elif command -v wget >/dev/null 2>&1; then
    wget -q "$URL" -O "$TMPDIR/$TARBALL"
else
    echo "ERROR: Neither curl nor wget found. Install one of them or download gitleaks manually."
    exit 1
fi

tar -xzf "$TMPDIR/$TARBALL" -C "$TMPDIR"
mv "$TMPDIR/gitleaks" "$INSTALL_DIR/gitleaks"
chmod +x "$INSTALL_DIR/gitleaks"

echo "gitleaks v${GITLEAKS_VERSION} installed to $INSTALL_DIR/gitleaks"
