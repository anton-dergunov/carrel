#!/bin/sh
# Fetches the browser libraries carrel serves, at pinned versions, into src/carrel/static/vendor.
# They are other people's files: replace them whole by changing a version here, never edit them.
set -eu
PDFJS=6.3.289      # the same as vscode-pdf-viewer
MARKED=18.1.0
DOMPURIFY=3.4.16
KATEX=0.19.0
HIGHLIGHT=11.12.0

cd "$(dirname "$0")/.."
out=src/carrel/static/vendor
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(cd "$tmp" && npm pack --silent "pdfjs-dist@$PDFJS" "marked@$MARKED" "dompurify@$DOMPURIFY" \
  "katex@$KATEX" "@highlightjs/cdn-assets@$HIGHLIGHT" >/dev/null)
for archive in "$tmp"/*.tgz; do
  mkdir "$archive.d" && tar -xzf "$archive" -C "$archive.d"
done

rm -rf "$out"
mkdir -p "$out/pdfjs" "$out/marked" "$out/dompurify" "$out/katex/fonts" "$out/highlight"

pdfjs="$tmp/pdfjs-dist-$PDFJS.tgz.d/package"
cp "$pdfjs/build/pdf.min.mjs" "$pdfjs/build/pdf.worker.min.mjs" \
   "$pdfjs/web/pdf_viewer.mjs" "$pdfjs/web/pdf_viewer.css" "$pdfjs/LICENSE" "$out/pdfjs/"
# Character maps, the standard fonts and the image decoders, for PDFs that need them.
for dir in images cmaps standard_fonts wasm iccs; do
  if [ -d "$pdfjs/web/$dir" ]; then cp -R "$pdfjs/web/$dir" "$out/pdfjs/"; fi
  if [ -d "$pdfjs/$dir" ]; then cp -R "$pdfjs/$dir" "$out/pdfjs/"; fi
done

marked="$tmp/marked-$MARKED.tgz.d/package"
cp "$marked/lib/marked.esm.js" "$marked/LICENSE" "$out/marked/"

dompurify="$tmp/dompurify-$DOMPURIFY.tgz.d/package"
cp "$dompurify/dist/purify.es.mjs" "$dompurify/LICENSE" "$out/dompurify/"

# The maths. Safari reads WOFF2, the first format the stylesheet names.
katex="$tmp/katex-$KATEX.tgz.d/package"
cp "$katex/dist/katex.mjs" "$katex/dist/katex.min.css" "$katex/LICENSE" "$out/katex/"
cp "$katex"/dist/fonts/*.woff2 "$out/katex/fonts/"

# Code: the build with the common languages.
highlight="$tmp/highlightjs-cdn-assets-$HIGHLIGHT.tgz.d/package"
cp "$highlight/es/highlight.min.js" "$highlight/LICENSE" "$out/highlight/"

cat > "$out/VERSIONS" <<VERSIONS
pdfjs-dist $PDFJS (Apache-2.0)
marked $MARKED (MIT)
dompurify $DOMPURIFY (Apache-2.0 or MPL-2.0)
katex $KATEX (MIT)
@highlightjs/cdn-assets $HIGHLIGHT (BSD-3-Clause)
VERSIONS
echo "vendored into $out:"; du -sh "$out"/*
