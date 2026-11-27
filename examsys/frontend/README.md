# Member 3 frontend module

Shared Member 3 UI modules live under `frontend/`; Next.js App Router entry points must stay under `app/`. Route-group layouts wrap authenticated areas in `AppShell`, and routes import reusable client UI from this folder.

## Design tokens

`app/globals.css` defines the semantic colors (`--bg`, `--surface`, `--text`, `--brand`, and status colors), radius, shadow, and page spacing. Set `data-theme` on `<html>` to `light`, `dark`, or `contrast`; `data-font-size` supports `S`, `M`, `L`, and `XL`; `data-density="compact"` reduces page spacing. Controls use `field-control`, `button-primary`, and `button-secondary` for consistent focus and contrast.

## Shared components

Import from `@/frontend/components/ui/*`. Components use native HTML controls and semantics where possible; provide accessible labels for controls, and keep status meaning in text as well as color. The shell is `@/frontend/components/app-shell`.

App Router pages and API handlers remain in `app/`; do not move route files into this module because Next.js only discovers routes under `app/`.
