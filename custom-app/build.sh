#!/usr/bin/env bash
set -euo pipefail

# Plansync Custom App build script
#
# Packages the manifest, iframe shell, icon, and README into a single
# .zip suitable for upload to a Rocketlane workspace. Run from anywhere:
#
#   bash custom-app/build.sh
#
# Output: custom-app/plansync-custom-app.zip
#
# To install in a Rocketlane workspace (admin only):
#   1. Workspace Settings → Custom Apps → Upload App
#   2. Select plansync-custom-app.zip
#   3. Enable on the desired projects
#   4. The "Plansync" tab appears in the workspace nav and on each
#      project where the app is enabled
#
# To verify the contents without installing:
#   unzip -l plansync-custom-app.zip

cd "$(dirname "$0")"

OUTPUT_ZIP="plansync-custom-app.zip"

# Files that go into the bundle. Keep this list explicit instead of
# using `zip -r .` so that we never accidentally include build artifacts,
# editor swap files, .DS_Store, or this build script itself.
FILES=(
  "manifest.json"
  "index.html"
  "icon.svg"
  "README.md"
)

# Sanity-check that every file exists before zipping
for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing required file: $f" >&2
    exit 1
  fi
done

# Remove any stale zip
rm -f "$OUTPUT_ZIP"

# Build the zip
zip -q "$OUTPUT_ZIP" "${FILES[@]}"

# Print verification
echo "✓ Built: $(pwd)/$OUTPUT_ZIP"
echo ""
echo "Contents:"
unzip -l "$OUTPUT_ZIP"
echo ""
echo "Size: $(du -h "$OUTPUT_ZIP" | cut -f1)"
echo ""
echo "Next step: upload $OUTPUT_ZIP via Workspace Settings → Custom Apps in Rocketlane"
