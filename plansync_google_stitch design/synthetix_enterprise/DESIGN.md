# Design System Document: The Intelligent Architect

## 1. Overview & Creative North Star
**Creative North Star: "The Digital Curator"**
This design system moves away from the rigid, boxy constraints of traditional enterprise software. Instead of a flat "dashboard," we treat the AI Project Plan Agent as a sophisticated editorial experience. The goal is to make complex project hierarchies feel curated and effortless. 

We break the "template" look through **Intentional Asymmetry** and **Tonal Depth**. By utilizing a "No-Line" philosophy and sophisticated typography scales, we transform technical data into a narrative. The interface should feel like a high-end workspace where the AI does the heavy lifting, and the human provides the strategic oversight.

---

## 2. Colors: Tonal Intelligence
Our palette leverages deep, intellectual blues (`primary`) and authoritative purples (`tertiary`). Reliability is not achieved through heavy borders, but through a calm, cohesive color story.

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to define sections. Boundaries are defined strictly through background shifts. For instance, a `surface-container-low` side panel sitting against a `surface` main content area provides all the separation needed without the visual "noise" of a line.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the surface tiers to create "nested" depth:
- **Base Level:** `surface` (#faf8ff) for the main application background.
- **Sectioning:** `surface-container-low` (#f2f3ff) for secondary layout areas.
- **Interactive Cards:** `surface-container-lowest` (#ffffff) to make active content "pop."
- **Nesting:** When placing a card inside a section, ensure the card is always a lighter tier than the container it sits in to simulate natural lift.

### The "Glass & Gradient" Rule
To elevate the "Premium" feel:
- **Floating Elements:** Use `surface_bright` with a 70% opacity and a `24px` backdrop blur for modals and dropdowns.
- **Signature Textures:** Apply a linear gradient from `primary` (#173ce5) to `primary_container` (#3c59fd) for primary CTAs and progress indicators. This adds a "visual soul" that flat colors lack.

---

## 3. Typography: Editorial Authority
We utilize a dual-font strategy to balance character with technical precision.

*   **Display & Headlines (Manrope):** Chosen for its geometric modernism. Use `display-lg` to `headline-sm` for high-level summaries and AI-generated titles. It conveys confidence and "New Enterprise" energy.
*   **Body & Labels (Inter):** The workhorse. Use `body-md` for technical data views and `label-sm` for metadata. Inter’s high x-height ensures that even dense project hierarchies remain legible.
*   **Intentional Contrast:** Pair a `headline-md` title with a `label-md` uppercase sub-header in `on_surface_variant` to create a sophisticated, magazine-style hierarchy.

---

## 4. Elevation & Depth: Tonal Layering
Traditional shadows are often cluttered. We use **Ambient Depth** to guide the user’s eye.

*   **The Layering Principle:** Depth is achieved by stacking. A `surface-container-highest` element placed on a `surface` background creates a natural focal point without needing an outline.
*   **Ambient Shadows:** For floating elements (like rich chat bubbles), use a shadow with a `32px` blur and `4%` opacity, tinted with the `on_surface` color (#131b2e). It should look like a soft glow of light, not a dark smudge.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility, use `outline_variant` at **15% opacity**. It should be felt, not seen.
*   **Glassmorphism:** Use for "floating" action bars. Use `surface_container_low` at 80% opacity with a `blur(12px)` to integrate the UI with the background content.

---

## 5. Components: The High-Fidelity Toolkit

### Rich Chat Bubbles
- **AI Response:** Use `surface_container_highest`. Apply a `xl` (1.5rem) corner radius on three sides, with the bottom-left corner at `sm` (0.25rem).
- **User Input:** Use `primary` background with `on_primary` text. No shadow.
- **Content:** Embed `body-md` for text and `surface_container_lowest` for nested project cards within the bubble.

### Project Hierarchy Tables
- **Layout:** Forbid divider lines between rows. Use a 4px vertical gap between rows.
- **States:** On hover, change the row background to `surface_container_high`.
- **Hierarchy:** Use `title-sm` for Task Names and `label-md` for metadata (Assignee, Due Date).

### File Upload Cards
- **Style:** A `surface_container_low` dashed area using a `Ghost Border`. 
- **Interaction:** On drag-over, transition the background to `primary_fixed` with a subtle `primary` glow.

### Progress Bars & Approval Buttons
- **Progress:** A 6px height track using `surface_container_highest` with a `primary` to `secondary` gradient fill.
- **Approval Button:** `primary` background, `xl` roundedness, using `title-sm` for the label. Use a `16px` horizontal padding to give the button "breath."

### Cards & Lists
- **Spacing:** Use a strict 24px (1.5rem) padding for all internal card content.
- **Separation:** Use vertical white space and color shifts rather than dividers to separate list items.

---

## 6. Do’s and Don’ts

### Do:
- **Do** use `surface-container` shifts to denote focus.
- **Do** use `Manrope` for all AI-generated headers to distinguish them from system text.
- **Do** lean into `xl` (1.5rem) rounded corners for large containers to soften the "enterprise" feel.
- **Do** use `outline_variant` at low opacity for input fields to maintain high-fidelity minimalism.

### Don’t:
- **Don’t** use 100% opaque black or grey shadows.
- **Don’t** use 1px solid borders to separate sidebars or header sections.
- **Don’t** use high-contrast dividers (`outline`) unless absolutely necessary for dense data accessibility.
- **Don’t** crowd the interface; if a view feels "heavy," increase the white space between `surface` tiers.