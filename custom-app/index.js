/**
 * Plansync — Rocketlane Custom App
 *
 * Declares the Plansync widget for the Rocketlane Custom Apps marketplace.
 * The widget is a thin iframe wrapper around the live Plansync frontend
 * hosted on Vercel, so users get bug fixes and new features the moment
 * we deploy — no need to rebuild and reinstall the Custom App .zip.
 *
 * The widget is registered at two surfaces:
 *   - left_nav: instance-wide entry point ("Plansync" appears in the
 *     workspace left navigation). Most natural surface for a tool that
 *     creates new projects from a CSV file.
 *   - project_tab: per-project tab. Useful for workspace admins who
 *     want to scope Plansync to specific projects in addition to the
 *     instance-wide entry point.
 *
 * No backend handlers, no scheduled actions, no installation params.
 * Plansync collects its own auth (Rocketlane API key) inside the iframe
 * via the existing ApiKeyCard flow on the Vercel-hosted frontend.
 */

const widgets = [
  {
    location: ["left_nav", "project_tab"],
    name: "Plansync",
    description:
      "AI agent that reads a project plan CSV or Excel file and creates it as a fully structured project in Rocketlane — phases, tasks, subtasks, milestones, and dependencies.",
    icon: "widgets/plansync/icon.svg",
    entrypoint: {
      html: "widgets/plansync/index.html",
    },
    identifier: "plansync",
    logo: "widgets/plansync/logo.png",
  },
];

module.exports = {
  widgets,
  version: "0.2.0",
};
