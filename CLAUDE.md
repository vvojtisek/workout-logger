# Project Guidelines
- Frontend: React + Vite + TypeScript (Tailwind CSS).
- Tests: vitest for frontend, pytest for backend. Run tests after every change.
- Security: Never violate CSP directives defined in `app/main.py` without updating `tests/test_static_pwa.py`.
- Commits: 1 PR per Slice as defined in AGENTS.md.

# Workout Logger UI/UX Overhaul Rules

## 1. Architecture & API Preservation
- Keep all FastAPI endpoints, database schemas, and MCP integrations intact unless a UI state requirement explicitly needs a new query parameter.
- Work in isolated vertical slices on branch `feat/ux-ui-overhaul` with atomic local commits after each verified slice.

## 2. Visual System (Extract from Scrollcraft References ONLY)
- Read `.claude/skills/scroll-craft/references/taste.md`, `feel.md`, and `devices.md`.
- DO NOT build scroll-driven marketing sections or hero banners. This is a high-density utility PWA.
- Enforce: 4px base spacing scale, max 2 font families (1 UI sans, 1 tabular-nums monospace for weights/reps/timers), strict dark-mode contrast compensation, and zero generic AI card clutter.

## 3. Behavioral UX Standards
- Active workout logging on mobile (360px-412px width) must require zero horizontal scrolling and minimal taps (+1 rep / +2.5kg quick-steppers, instant optimistic state updates, persistent bottom rest-timer bar).
- Desktop view (1280px+) must switch to a multi-column analytical dashboard (session history, volume progression, muscle-group split) rather than stretching the mobile column.

## 4. Mandatory Verification Gate (`playwright-cli`)
- After every UI slice, start the local stack and verify with `playwright-cli` at `390x844` (mobile) and `1440x900` (desktop).
- Take screenshots, test rapid stepper clicks, verify zero console/network errors, and confirm touch targets are >= 44x44px.
