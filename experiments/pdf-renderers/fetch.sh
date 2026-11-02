#!/bin/sh
# Fetches the renderers the bench compares with PDF.js, at pinned versions, into vendor/.
# They are other people's files: replace them whole by changing a version here, never edit them.
# PDF.js itself is carrel's (scripts/vendor.sh), served from /static/vendor/pdfjs/.
set -eu
EMBEDPDF=2.15.1   # MIT: PDFium compiled to WebAssembly, with its viewer
MUPDF=1.28.1      # AGPL-3.0: MuPDF compiled to WebAssembly, no viewer

cd "$(dirname "$0")"
out=vendor
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(cd "$tmp" && npm pack --silent "@embedpdf/snippet@$EMBEDPDF" "mupdf@$MUPDF" >/dev/null)
for archive in "$tmp"/*.tgz; do
  mkdir "$archive.d" && tar -xzf "$archive" -C "$archive.d"
done

rm -rf "$out"
mkdir -p "$out/embedpdf" "$out/mupdf"

embedpdf="$tmp/embedpdf-snippet-$EMBEDPDF.tgz.d/package"
cp "$embedpdf"/dist/*.js "$embedpdf/dist/pdfium.wasm" "$embedpdf/LICENSE" "$out/embedpdf/"

mupdf="$tmp/mupdf-$MUPDF.tgz.d/package"
cp "$mupdf/dist/mupdf.js" "$mupdf/dist/mupdf-wasm.js" "$mupdf/dist/mupdf-wasm.wasm" "$mupdf/LICENSE" "$out/mupdf/"

cat > "$out/VERSIONS" <<VERSIONS
@embedpdf/snippet $EMBEDPDF (MIT)
mupdf $MUPDF (AGPL-3.0-or-later)
VERSIONS
echo "vendored into $out:"; du -sh "$out"/*
