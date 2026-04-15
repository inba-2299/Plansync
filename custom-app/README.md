# Plansync Rocketlane Custom App

This directory contains the source for the **Plansync Rocketlane Custom App** — a packaged `.zip` that lets Rocketlane workspace admins install Plansync as a workspace + project tab, so users can run the project-plan-creation agent **inside Rocketlane** rather than alongside it.

## TL;DR

```bash
# 1. One-time: install the Rocketlane CLI globally
npm install -g @rocketlane/rli

# 2. Build the Custom App .zip
bash custom-app/build.sh

# 3. Upload custom-app/plansync-custom-app.zip via
#    Rocketlane → Workspace Settings → Custom Apps → Create App
```

The pre-built `plansync-custom-app.zip` is already committed in this directory if you'd rather skip the build step.

## What's in this directory

| File | Purpose |
|---|---|
| `index.js` | Rocketlane Custom App manifest — declares the Plansync widget, its surfaces (`left_nav` + `project_tab`), version, icon path |
| `package.json` | Tiny npm package declaring `@rocketlane/rli` as a devDep so `rli build` works locally |
| `widgets/plansync/index.html` | The widget shell — full-viewport iframe wrapper that loads `https://plansync-tau.vercel.app?embed=1` |
| `widgets/plansync/icon.svg` | Plansync brand mark (purple gradient lightning bolt) |
| `build.sh` | Wrapper around `rli build` that produces `plansync-custom-app.zip` and verifies `rli-dist/deploy.json` is present in the output |
| `plansync-custom-app.zip` | The pre-built upload artifact (~200 KB) — committed for direct download |
| `README.md` | This file |

## Architecture: why an iframe wrapper inside the widget HTML

The Plansync widget HTML is a thin shell that does one job: full-viewport iframe to `https://plansync-tau.vercel.app?embed=1`. When the frontend detects `?embed=1` in the URL it hides its top header (Rocketlane provides its own chrome).

**Why not bundle the full Next.js frontend into the widget?**

1. **Bundle size + update story.** The current widget HTML is ~3.5 KB. The full Next.js static export would be 500 KB-5 MB and would need to be rebuilt + repackaged + reinstalled every time the frontend changes. The iframe approach lets users get bug fixes and new features the moment we deploy to Vercel, with zero touch on the Custom App side.

2. **Backend connectivity.** Plansync needs an outbound connection to its agent backend on Railway (`https://plansync-production.up.railway.app`). The iframe approach inherits the browser's normal cross-origin behavior. A bundled static export would have to either embed the same cross-origin fetch logic (no real difference) or proxy through Rocketlane's runtime (impossible without backend-side support from Rocketlane).

**Trade-off.** Rocketlane's Custom App widget runtime might apply CSP that blocks loading a cross-origin iframe from `vercel.app`. If that turns out to be the case, the fallback is to bundle the full Next.js static export inside `widgets/plansync/` instead of using an iframe. The trade-off is documented in `docs/DESIGN.md` § AD-10.

## How `rli build` works

The Rocketlane CLI (`rli`) takes the source files in this directory and produces an installable `app.zip` whose structure looks like:

```
app.zip
├── .rli/
│   ├── installation.json
│   └── kv.json
├── index.js                     ← The manifest source (preserved)
├── package.json
├── rli-dist/                    ← Build output (what Rocketlane validates)
│   ├── deploy.json              ← THIS file is what Rocketlane checks for
│   ├── r.js                     ← RLI runtime
│   ├── rli-server.js            ← RLI server runtime
│   └── *.map files
└── widgets/
    └── plansync/
        ├── icon.svg
        └── index.html           ← After template processing
```

The critical file is **`rli-dist/deploy.json`** — Rocketlane's upload validator looks for it at the root of the zip. If it's missing or malformed, you get the error: `Invalid zip: rli-dist/deploy.json not found in the uploaded file.`

Our `deploy.json` (auto-generated from `index.js`) looks like:

```json
{
  "widgets": [
    {
      "entrypoint": { "html": "widgets/plansync/index.html" },
      "widgetName": "Plansync",
      "widgetDescription": "AI agent that reads a project plan CSV or Excel file and creates it as a fully structured project in Rocketlane — phases, tasks, subtasks, milestones, and dependencies.",
      "widgetIdentifier": "plansync",
      "logo": "widgets/plansync/icon.svg",
      "supportedLocations": {
        "locations": ["left_nav", "project_tab"]
      }
    }
  ],
  "version": "0.2.0",
  "isCustomEventHandlerPresent": false,
  "appEvents": []
}
```

## Installing in a Rocketlane workspace

Workspace admins only:

1. Go to **Workspace Settings → Custom Apps** in Rocketlane
2. Click **Create App**
3. Enter:
   - **App Name:** `Plansync`
   - **App Description:** `AI agent that reads a project plan CSV/Excel file and creates it as a fully structured project in Rocketlane.`
4. Drag and drop `plansync-custom-app.zip` into the upload zone
5. Click **Install**
6. The "Plansync" widget should appear:
   - In the workspace left navigation (from the `left_nav` location declaration)
   - As a tab on every project (from the `project_tab` location declaration)

## Embed-mode behavior on the frontend

When the Plansync frontend detects `?embed=1` in the URL (which the Custom App widget HTML always passes), it:

1. Hides the Plansync app header bar (Rocketlane provides its own chrome)
2. Replaces it with a slim toolbar containing only the "New session" button, the journey stepper, and the "Connected" status pill
3. Adjusts the layout to use the available iframe viewport

Everything else is identical to the standalone experience. Same SSE streaming, same agent loop, same Rocketlane API calls, same Redis session store, same refresh-safe sessions via the event log replay (Commit 2g).

## Versioning

The Custom App version in `index.js` (`0.2.0`) is independent of the Next.js frontend version. We bump it when:
- The manifest itself changes (new surface, new permission, new identifier)
- The iframe shell changes (different `?embed=1` query param shape, different sandbox attributes, new iframe sources)

We do NOT bump it for frontend-only changes — those go live automatically via the iframe.

## Limitations + known unknowns

- **Cross-origin iframe approval.** If the Rocketlane Custom App widget runtime blocks iframes to `vercel.app`, the widget will show the "Loading Plansync…" placeholder indefinitely. Mitigation: switch to a fully-bundled static export (more work, larger zip, no live updates).
- **No backend handlers.** Plansync's agent backend lives on Railway, not inside Rocketlane's runtime. We don't use `r.kv`, `r.scheduler`, or any of the RLI server SDK. If we ever need to run code inside Rocketlane's runtime (e.g. webhook handlers for Rocketlane events that should affect Plansync sessions), we'd add them via the `serverActions` array in `index.js`.
- **No installation parameters.** We don't ask the workspace admin for any config at install time. The end-user enters their Rocketlane API key inside the Plansync UI via the existing `ApiKeyCard` flow. This is intentional: it keeps the Custom App install path frictionless and lets every individual user use their own API key.

## Reverting / removing the app

If something goes wrong or you want to clean up:

1. **From Rocketlane:** Workspace Settings → Custom Apps → find Plansync → Uninstall
2. **From this repo:** the `plansync-custom-app.zip` is just a build artifact; you can rebuild it anytime with `bash custom-app/build.sh`

## See also

- [`docs/DESIGN.md`](../docs/DESIGN.md) § AD-10 (Custom App via iframe wrapper) — original design rationale
- [`MEMORY.md`](../MEMORY.md) — Session 4 decision log including the Custom App pivot from manual `manifest.json` to `rli build`
- [Rocketlane Custom Apps overview](https://help.rocketlane.com/support/solutions/articles/67000745884-introducing-custom-apps-build-what-you-need-inside-rocketlane)
- [Rocketlane Developer Documentation](https://developer.rocketlane.com/v1.3/docs/app-development-process)
- [@rocketlane/rli on npm](https://www.npmjs.com/package/@rocketlane/rli)
