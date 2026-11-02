#!/bin/sh
# Build the Mac app, Electron's Chromium around carrel's page: macos/build/Carrel.app.
#
#   ./scripts/mac-app.sh            build it
#   ./scripts/mac-app.sh --test     run its tests (the ones that need no window)
#   ./scripts/mac-app.sh --install  build it and put it in ~/Applications
#   ./scripts/mac-app.sh --dev      run it from the checkout, without building
#
# Needs Node and npm; npm fetches Electron and the packager at the versions macos/package.json pins.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/macos"
[ -d node_modules/electron/dist ] || { npm ci --no-fund --no-audit && node node_modules/electron/install.js; }
case "${1:-}" in
  --test)
    node --test "$ROOT"/tests/mac-*.test.mjs
    ;;
  --dev)
    # VS Code's terminal sets this, which makes Electron run as plain Node.
    unset ELECTRON_RUN_AS_NODE
    exec npx electron .
    ;;
  ""|--install)
    rm -rf build
    npx electron-packager . Carrel --platform=darwin --arch=arm64 --out=build --overwrite --quiet \
      --icon=resources/icon.icns --app-bundle-id=com.anton.carrel.app \
      --app-category-type=public.app-category.education --app-copyright="MIT licence" \
      --ignore='^/build($|/)'
    ditto build/Carrel-darwin-arm64/Carrel.app build/Carrel.app
    rm -rf build/Carrel-darwin-arm64
    # Signed to run on this Mac; a Developer ID for handing it to others is plan step 1's.
    codesign --force --deep --sign - build/Carrel.app
    echo "built $(pwd)/build/Carrel.app"
    if [ "${1:-}" = --install ]; then
      mkdir -p "$HOME/Applications"
      osascript -e 'quit app id "com.anton.carrel.app"' 2>/dev/null || true
      rm -rf "$HOME/Applications/Carrel.app"
      ditto build/Carrel.app "$HOME/Applications/Carrel.app"
      echo "installed $HOME/Applications/Carrel.app"
    fi
    ;;
  *)
    echo "usage: $0 [--test | --install | --dev]" >&2
    exit 2
    ;;
esac
