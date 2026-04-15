# Plansync Custom App

This directory contains the source files for the **Plansync Rocketlane Custom App** — a packaged `.zip` that lets Rocketlane workspace admins install Plansync as a workspace and project tab, so users can run the project-plan-creation agent **inside Rocketlane** rather than alongside it.

## What's in this directory

| File | Purpose |
|---|---|
| `manifest.json` | Rocketlane Custom App manifest declaring the app's surfaces (workspace-tab + project-tab), permissions, and metadata |
| `index.html` | Iframe wrapper shell that loads the live Plansync frontend with `?embed=1` |
| `icon.svg` | Plansync brand mark (purple gradient lightning bolt) shown in the Rocketlane Custom Apps catalog |
| `build.sh` | Packaging script — produces `plansync-custom-app.zip` |
| `README.md` | This file |

## Why an iframe wrapper instead of a fully-bundled static export

Two reasons.

**Bundle size + update story.** The iframe shell is ~5 KB. A full static export of the Next.js frontend would be 500 KB to 5 MB and would need to be rebuilt + repackaged + reinstalled every time the frontend changes. The iframe approach lets users get bug fixes and new features the moment we deploy to Vercel, with zero touch on the Custom App side.

**Backend connectivity.** Plansync needs an outbound connection to its agent backend on Railway (`https://plansync-production.up.railway.app`). The iframe approach inherits the browser's normal cross-origin behavior. A bundled static export would have to either embed the same cross-origin fetch logic (no real difference) or proxy through Rocketlane's infrastructure (impossible without backend-side support from Rocketlane).

**Trade-off.** The Rocketlane workspace must allow loading a cross-origin iframe from `https://plansync-tau.vercel.app`. If the workspace CSP blocks it, the fallback is to bundle the full Next.js static export into this directory. The trade-off is documented in `docs/DESIGN.md` § AD-10.

## Building the .zip

From the repo root:

```bash
bash custom-app/build.sh
```

This produces `custom-app/plansync-custom-app.zip` (~5 KB) and prints the contents for verification.

The script:
- Verifies every required file exists
- Excludes the build script itself from the bundle
- Excludes editor swap files, `.DS_Store`, and other noise (uses an explicit file list, not `zip -r .`)
- Prints contents + size after building

## Installing in a Rocketlane workspace

Workspace admins only:

1. Go to **Workspace Settings → Custom Apps** in the Rocketlane navigation
2. Click **Upload App**
3. Select `plansync-custom-app.zip`
4. Enable the app for the workspace and any projects where it should appear
5. The "Plansync" tab appears in the workspace navigation; the project-tab variant appears on each project where the app is enabled

## What the user sees once installed

**From the workspace tab.** Plansync greets the user, asks for their Rocketlane API key (encrypted at rest), and walks them through uploading a project plan CSV/Excel file. The agent infers metadata where it can (project name from filename, customer from workspace context, owner from team members) and asks for anything it can't infer. Once the user approves the parsed plan, the agent creates the full project in Rocketlane in 3-5 seconds.

**From the project tab.** Same flow, but the URL contains `&projectId={{project.id}}` (Rocketlane substitution) so future versions can scope the agent to "add to this project" rather than "create a new project". Today the project-id parameter is parsed but not yet used — a post-submission enhancement.

## Embed-mode behavior

When the frontend detects `?embed=1` in the URL, it:

1. Hides the Plansync app header (Rocketlane provides its own chrome — duplicating the header would feel cluttered)
2. Adjusts the layout to use the available iframe viewport

Everything else is identical to the standalone experience. Same SSE streaming, same agent loop, same Rocketlane API calls, same Redis session store.

## Sandbox configuration

The iframe is loaded with this sandbox attribute:

```html
sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
```

- `allow-scripts` — required for the React app to run
- `allow-same-origin` — required so the frontend can read its own localStorage (which is how session persistence works after Commit 2g)
- `allow-forms` — required for the API key submission form
- `allow-popups` + `allow-popups-to-escape-sandbox` — so the "View in Rocketlane" button at the end of a successful run can open the created project in a new tab
- `allow-downloads` — for the downloadable CSV template feature

## Versioning

The Custom App version in `manifest.json` (`0.2.0`) is independent of the Next.js frontend version. We bump it when:
- The manifest itself changes (new surface, new permission)
- The iframe shell changes (different `?embed=1` query param shape, different sandbox attributes)

We do NOT bump it for frontend-only changes — those go live automatically via the iframe.

## Verification

Before submitting, this Custom App is verified by:

1. Running `bash build.sh` to produce the .zip
2. Uploading the .zip to a real Rocketlane workspace (`inbarajb.rocketlane.com`)
3. Opening the Plansync tab from a project page
4. Walking through the full agent flow end-to-end inside the iframe (API key → workspace confirm → upload → plan review → approve → execute → completion card)
5. Verifying the created project appears correctly in Rocketlane outside the iframe
