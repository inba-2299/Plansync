#!/usr/bin/env bash
set -euo pipefail

# Plansync Rocketlane Custom App build script
#
# Wraps `rli build` (the official Rocketlane CLI) and renames the
# resulting `app.zip` to `plansync-custom-app.zip` for clarity in the
# repo. Run from anywhere:
#
#   bash custom-app/build.sh
#
# Prerequisites: Rocketlane CLI installed globally
#   npm install -g @rocketlane/rli
#
# Output: custom-app/plansync-custom-app.zip (~200 KB)
#
# What `rli build` does:
#   1. Validates index.js (the manifest)
#   2. Bundles server files (we have none)
#   3. Bundles RLI Core runtime
#   4. Generates rli-dist/deploy.json (the manifest Rocketlane validates)
#   5. Validates each widget's HTML and identifier
#   6. Processes HTML templates (substitutes <%= rocketlaneSdk %> if present)
#   7. Packs everything into app.zip
#
# To install in a Rocketlane workspace (admin only):
#   1. Workspace Settings → Custom Apps → Create App
#   2. Set name + description
#   3. Drag & drop plansync-custom-app.zip
#   4. Click Install
#   5. The "Plansync" widget appears in the workspace left nav AND on
#      project tabs (declared at both surfaces in index.js)
#
# To verify the contents without installing:
#   unzip -l plansync-custom-app.zip
#   # confirm rli-dist/deploy.json is present at the root

cd "$(dirname "$0")"

# Sanity check: rli must be installed
if ! command -v rli &>/dev/null; then
  echo "ERROR: rli (Rocketlane CLI) not found in PATH" >&2
  echo "Install it with: npm install -g @rocketlane/rli" >&2
  exit 1
fi

# Clean stale build artifacts before running rli build
rm -rf rli-dist app.zip plansync-custom-app.zip

# Run the official RLI build
echo "→ Running rli build..."
rli build

# rli build produces app.zip; rename to a clearer name for the repo
if [[ ! -f app.zip ]]; then
  echo "ERROR: rli build did not produce app.zip" >&2
  exit 1
fi
mv app.zip plansync-custom-app.zip

# Verify the produced zip contains the file Rocketlane validates against
if ! unzip -l plansync-custom-app.zip | grep -q 'rli-dist/deploy.json'; then
  echo "ERROR: built zip is missing rli-dist/deploy.json — Rocketlane will reject it" >&2
  exit 1
fi

echo ""
echo "✓ Built: $(pwd)/plansync-custom-app.zip"
echo ""
echo "Size: $(du -h plansync-custom-app.zip | cut -f1)"
echo ""
echo "Contents:"
unzip -l plansync-custom-app.zip
echo ""
echo "Next step: upload plansync-custom-app.zip via Workspace Settings → Custom Apps → Create App in Rocketlane"
