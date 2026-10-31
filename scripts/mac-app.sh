#!/bin/sh
# Build the Mac app: macos/build/Carrel.app.
#
#   ./scripts/mac-app.sh            build it
#   ./scripts/mac-app.sh --test     run its unit tests
#   ./scripts/mac-app.sh --install  build it and put it in ~/Applications
#
# Needs Xcode and XcodeGen (brew install xcodegen), which makes Carrel.xcodeproj from project.yml.
set -eu
cd "$(dirname "$0")/../macos"
xcodegen generate --quiet
build() {
  xcodebuild -project Carrel.xcodeproj -scheme Carrel -derivedDataPath build/derived -quiet "$@"
}
case "${1:-}" in
  --test)
    build test
    ;;
  ""|--install)
    build -configuration Release build
    rm -rf build/Carrel.app
    ditto build/derived/Build/Products/Release/Carrel.app build/Carrel.app
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
    echo "usage: $0 [--test | --install]" >&2
    exit 2
    ;;
esac
