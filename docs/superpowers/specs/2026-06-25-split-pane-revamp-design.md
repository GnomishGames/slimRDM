# Split Pane Revamp — Design Spec
_Date: 2026-06-25_

## Overview

Replace the current flat split-view (a Settings toggle + 1D array of up to 3 sessions) with a Tilix-style recursive binary split tree. Panes are created, resized, and closed directly from per-pane header controls — no settings required.

---

## Goals

- Per-pane "split right" / "split down" buttons create new panes live
- Splitting duplicates the same connection (new session to the same host)
- Panes are resizable by dragging dividers
- Hard limit of 4 panes
- In split mode, the tab bar is hidden; pane headers provide all navigation context
- Single-session mode is unchanged (tab bar, no pane headers)
- Remove `splitView` / `splitViewDirection` settings entirely

---

## Data Model

### Types (`src/types/index.ts`)

```ts
export interface PaneLeaf {
  type: "leaf";
  sessionId: string;
}

export interface PaneSplit {
  type: "split";
  direction: "vertical" | "horizontal";
  // vertical  = left | right  (vertical divider line)
  // horizontal = top | bottom (horizontal divider line)
  ratio: number;   // 0–1, fraction of space given to `first`
  first: PaneNode;
  second: PaneNode;
}

export type PaneNode = PaneLeaf | PaneSplit;
```

A 2×2 grid is represented as:
```
VSplit(0.5)
├── HSplit(0.5)  [first]
│   ├── leaf(A)
│   └── leaf(B)
└── HSplit(0.5)  [second]
    ├── leaf(C)
    └── leaf(D)
```

### Helper (`src/utils/paneTree.ts`)

Pure functions, no store imports:

```ts
countLeaves(node: PaneNode): number
findLeafPath(node: PaneNode, sessionId: string): ("first"|"second")[] | null
insertSplit(node: PaneNode, sessionId: string, direction, newSessionId): PaneNode
removeLeaf(node: PaneNode, sessionId: string): PaneNode | null
  // returns null when the root itself is removed
  // returns the sibling when a leaf's parent split is removed
updateRatio(node: PaneNode, path: ("first"|"second")[], ratio: number): PaneNode
```

---

## Store Changes

### `appStore.ts`

**Remove:** `splitSessionIds: string[]`, `setSplitSessions`

**Add:**

```ts
paneRoot: PaneNode | null;   // null = no split (single active session)

splitPane(sessionId: string, direction: "vertical" | "horizontal"): void;
closePane(sessionId: string): void;
setPaneRatio(path: ("first"|"second")[], ratio: number): void;
```

**`splitPane` implementation:**
1. Guard: `countLeaves(paneRoot) >= 4` → no-op
2. Call `openSession(session.connection)` → `newSessionId`
3. If `paneRoot` is null: set `paneRoot = { type: "leaf", sessionId }` first, then split
4. Replace tree: `insertSplit(paneRoot, sessionId, direction, newSessionId)`
5. Set `activeSessionId = newSessionId`

**`closePane` implementation:**
1. Call `closeSession(sessionId)` (disconnects + removes from `sessions[]`)
2. `const next = removeLeaf(paneRoot, sessionId)`
3. If `next` is a leaf or null → `paneRoot = null` (exit split mode, tab bar returns)
4. Else `paneRoot = next`
5. If `activeSessionId === sessionId` → set active to any remaining leaf

**`setPaneRatio` implementation:**
- `paneRoot = updateRatio(paneRoot, path, ratio)`

**`setActiveSession`** — unchanged.

### `settingsStore.ts` / `BehaviorSettings`

**Remove:** `splitView: boolean`, `splitViewDirection: "vertical" | "horizontal"`

Update `DEFAULT_BEHAVIOR` and the `BehaviorSettings` interface accordingly. Remove from persisted store load/save.

---

## Components

### `SplitContainer` (`src/components/session/SplitContainer.tsx`)

Recursive renderer:

```tsx
function SplitContainer({ node, path }: { node: PaneNode; path: ("first"|"second")[] }) {
  if (node.type === "leaf") {
    return <PaneWrapper sessionId={node.sessionId} path={path} />;
  }
  return (
    <div className={`split-node split-node--${node.direction}`}>
      <SplitContainer node={node.first}  path={[...path, "first"]}  />
      <SplitDivider direction={node.direction} path={path} />
      <SplitContainer node={node.second} path={[...path, "second"]} />
    </div>
  );
}
```

CSS: `split-node--vertical` → `flex-direction: row`; `split-node--horizontal` → `flex-direction: column`. The first child's size is set via **inline style** (`flex: 0 0 ${ratio * 100}%`) since ratio is dynamic per-node. The second child is `flex: 1 1 0` (fills remaining space).

### `PaneWrapper` (`src/components/session/PaneWrapper.tsx`)

```tsx
function PaneWrapper({ sessionId, path }) {
  const { paneRoot, setActiveSession } = useAppStore();
  const session = useAppStore(s => s.sessions.find(x => x.id === sessionId));
  const active = useAppStore(s => s.activeSessionId === sessionId);
  const canSplit = countLeaves(paneRoot) < 4;

  return (
    <div className={clsx("pane-wrapper", active && "pane-wrapper--focused")}
         onClick={() => setActiveSession(sessionId)}>
      <PaneHeader session={session} path={path} canSplit={canSplit} />
      <SessionPanel session={session} active focused={active} />
    </div>
  );
}
```

### `PaneHeader` (`src/components/session/PaneHeader.tsx`)

Slim 24px bar, always visible:

- Left: status dot + connection label
- Right: split-vertical icon button · split-horizontal icon button · ✕ close button
- Split buttons disabled + dimmed when `!canSplit`

Icons: use existing Lucide icons — `Columns2` (or `PanelLeft`) for vertical split, `Rows2` (or `PanelTop`) for horizontal split, `X` for close.

### `SplitDivider` (`src/components/session/SplitDivider.tsx`)

Drag handle, ~4px wide/tall. On `mousedown`, tracks mouse movement and calls `setPaneRatio(path, newRatio)`. Enforces `MIN_PANE_PCT = 10` (same constant as today, repurposed as min ratio %).

### `App.tsx` — modified

Split entry point when `paneRoot` is null: add small "split vertical" (`⬛|`) and "split horizontal" (`⬛—`) icon buttons to the right end of `SessionTabs`. Clicking one calls `splitPane(activeSessionId, direction)`. These buttons are only shown when at least one session is open.

```tsx
const paneRoot = useAppStore(s => s.paneRoot);
const isSplit = paneRoot?.type === "split";

// In JSX:
<div className="main-area">
  {sessions.length > 0 ? (
    <>
      {!isSplit && <SessionTabs />}  {/* includes split-entry buttons on right */}
      <div ref={contentRef} className="session-content">
        {isSplit
          ? <SplitContainer node={paneRoot} path={[]} />
          : <SessionPanel session={activeSession} active focused />
        }
      </div>
    </>
  ) : (
    <EmptyState />
  )}
</div>
```

In single-session mode (`!isSplit`): tab bar shown (with split-entry buttons), single `SessionPanel` rendered directly — no `PaneWrapper`, no pane header. In split mode: tab bar hidden, `SplitContainer` takes over entirely.

Remove all existing split-related logic from `App.tsx`: `effectiveSizes`, `splitSizes`, `handleDividerMouseDown`, `getPaneStyle`, `getDividerStyle`, `equalSizes`, `axisOffset`, `calcStr`, and all `splitView`/`splitViewDirection` references.

### `SettingsModal.tsx` — modified

Remove the `splitView` checkbox row and the `splitViewDirection` toggle from `BehaviorSection`. No other changes.

---

## Session Lifecycle Notes

- `SessionPanel` must never unmount while a session is active — the current `display: none` pattern for inactive panels remains valid. In split mode all leaf sessions are active.
- `PaneWrapper` passes `active={true}` and `focused={sessionId === activeSessionId}` to `SessionPanel` so `fit()` and `term.focus()` work correctly.
- When `paneRoot` is null, `App.tsx` renders a single `SessionPanel` for `activeSessionId` directly (no `PaneWrapper`, no pane header) — this is the unchanged single-session experience.

---

## CSS

New classes needed:

```css
.split-node { display: flex; width: 100%; height: 100%; }
.split-node--vertical  { flex-direction: row; }
.split-node--horizontal { flex-direction: column; }

.pane-wrapper { display: flex; flex-direction: column; overflow: hidden; position: relative; }
.pane-wrapper--focused { outline: 1px solid var(--accent); }  /* subtle focus ring */

.pane-header { display: flex; align-items: center; height: 24px; padding: 0 6px;
               background: var(--tab-bg); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.pane-header-label { flex: 1; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pane-header-actions { display: flex; gap: 2px; }
.pane-header-btn { /* icon button, same style as tab-close */ }
.pane-header-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.split-divider-v { width: 4px; cursor: col-resize; background: var(--border); flex-shrink: 0; }
.split-divider-h { height: 4px; cursor: row-resize; background: var(--border); flex-shrink: 0; }
```

Remove old `.split-divider`, `.split-divider--vertical`, `.split-divider--horizontal` classes.

---

## Removed / Cleaned Up

| What | Where |
|------|-------|
| `splitSessionIds` state + `setSplitSessions` action | `appStore.ts` |
| `splitView` + `splitViewDirection` settings | `settingsStore.ts`, `types/index.ts` |
| Split settings UI | `SettingsModal.tsx` BehaviorSection |
| All split layout logic in `App.tsx` | `App.tsx` |
| `equalSizes`, `axisOffset`, `calcStr`, `DIVIDER_PX`, `MIN_PANE_PCT` constants in App | `App.tsx` (MIN_PANE_PCT moves to `SplitDivider`) |

---

## Files Touched

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `PaneLeaf`, `PaneSplit`, `PaneNode`; remove from `BehaviorSettings` |
| `src/utils/paneTree.ts` | **New** — pure tree helper functions |
| `src/store/appStore.ts` | Replace split state/actions |
| `src/store/settingsStore.ts` | Remove `splitView`/`splitViewDirection` |
| `src/App.tsx` | Remove old split logic, render `SplitContainer` or single panel |
| `src/components/session/SplitContainer.tsx` | **New** |
| `src/components/session/PaneWrapper.tsx` | **New** |
| `src/components/session/PaneHeader.tsx` | **New** |
| `src/components/session/SplitDivider.tsx` | **New** |
| `src/components/session/SessionTabs.tsx` | Add split-entry icon buttons to right of tab bar |
| `src/components/modals/SettingsModal.tsx` | Remove split settings rows |
| `src/styles.css` | Add pane/split CSS, remove old split-divider classes |
