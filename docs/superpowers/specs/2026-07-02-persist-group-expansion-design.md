# Persist Group Expand/Collapse State — Design

**Date:** 2026-07-02
**Status:** Approved (pending user review)

## Problem

SlimRDM always launches with sidebar groups collapsed. Group expand/collapse
state is held only in local component state, so it resets on every launch and
the user must re-expand their groups each time.

## Goal

Groups in the sidebar reopen on launch in the same expanded/collapsed state the
user left them in.

**Scope:** Groups only. Category auto-expand behavior and the Tunnels section
toggle are unchanged. (Extending to categories/tunnels later is trivial but not
part of this change.)

## Current State

- `src/components/sidebar/Sidebar.tsx` holds
  `expandedGroups: Set<string>` in local `useState(new Set())` — empty on every
  mount, so all groups start collapsed.
- `toggleGroup`, `handleCollapseAll`, `handleExpandAll` mutate that set purely
  in memory.
- `src/store/settingsStore.ts` already persists UI/config to `settings.json`
  via `@tauri-apps/plugin-store`. `settingsStore.load()` runs at app startup.

## Approach

Reuse the existing settings-store persistence pattern rather than introducing a
new mechanism. Add one persisted key for the expanded group IDs; the Sidebar
seeds its local Set from it and writes back on every toggle.

Store an **array of IDs** in `settings.json` (JSON has no `Set`); convert to a
`Set` at the component boundary.

## Changes

### `src/store/settingsStore.ts`
- Add `expandedGroupIds: string[]` to `SettingsState`, default `[]`.
- In `load()`, read the saved value (like the other keys) and set it.
- Add action `setExpandedGroupIds: (ids: string[]) => void` that updates state
  and writes to the store — same shape as `setBehavior` / `setLogging`.

### `src/components/sidebar/Sidebar.tsx`
- **Derive** `expandedGroups` from the settings store rather than keeping a
  separate local `useState`:
  `const expandedGroupIds = useSettingsStore((s) => s.expandedGroupIds);`
  `const expandedGroups = useMemo(() => new Set(expandedGroupIds), [expandedGroupIds]);`
  This is deliberate: `loadSettings()` runs inside a post-mount `useEffect` in
  `App.tsx`, so it completes **after** the Sidebar's first render. A one-time
  lazy `useState` seed would read the default `[]` and never pick up the
  persisted value. Deriving from the store means the component re-renders with
  the persisted set automatically once `load()` finishes.
- `toggleGroup`, `handleCollapseAll`, `handleExpandAll`, and the auto-expand of
  a newly created group all write the next id list via `setExpandedGroupIds`;
  the store update drives the re-render.

No backend/Rust changes. No new Tauri capabilities.

## Edge Cases

- **New/unseen groups:** not in the saved list → rendered collapsed, matching
  today's default. No special handling.
- **Deleted groups:** stale IDs in the saved list never match a live group and
  are harmless. Left as-is for simplicity (no cleanup pass).

## Testing

Manual verification via `npm run tauri dev`:
1. Expand two groups, restart → both stay expanded.
2. Collapse-all, restart → all collapsed.
3. Create a new group → starts collapsed (unchanged behavior).
