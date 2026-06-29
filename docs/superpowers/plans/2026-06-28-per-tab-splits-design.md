# Per-Tab Split Layouts + Graceful Exit Closes Tab

**Date:** 2026-06-28  
**Branch:** main

## Problem

1. Clicking a split button in the tab bar hides the entire tab bar (replaced by per-pane PaneHeader chrome). Users lose navigation.
2. Typing `exit` in an SSH terminal triggers autoReconnect instead of closing the tab. Disconnect handlers call `closeSession` (doesn't update the pane tree) instead of `closePane`.

## Solution

- Each tab independently manages its own split layout. The tab bar is always visible.
- SSH graceful exits (shell EOF) emit a distinct `"closed"` event → always close pane, no reconnect.
- Disconnect handlers use `closePane` (pane-tree-aware) instead of `closeSession`.

## Global Constraints

- No React StrictMode.
- All sessions keep their mounted DOM nodes (no remounting xterm). Panel visibility is CSS-only.
- `tabId: string` on `Session` is always set — primary sessions have `tabId === session.id`; secondary (split) sessions have `tabId` pointing to their primary.
- `tabLayouts: Record<string, PaneNode>` in the store replaces global `paneRoot`. Keys are primary session IDs.
- Tab bar renders `sessions.filter(s => s.tabId === s.id)` (primary sessions only).
- Active tab ID is derived: `sessions.find(s => s.id === activeSessionId)?.tabId ?? activeSessionId`.
- `closePane(secondaryId)` removes just that leaf from the split tree.
- `closePane(primaryId)` OR `closeTab(primaryId)` closes the entire tab (primary + all secondaries with matching tabId).
- SSH Rust: `channel_eof` (graceful shell exit) → emit `ssh-status { status: "closed" }`; `SshInput::Disconnect` (frontend-initiated) → emit nothing.
- No new Tauri commands.
- TypeScript must compile clean after each task.

## Tasks

### Task 1: Add `tabId` to `Session` type
**File:** `src/types/index.ts`

Add `tabId: string` to the `Session` interface. This field identifies the primary session this session belongs to. For primary sessions, `tabId === session.id`. For secondary sessions (created by splitting), `tabId` is the primary session's ID.

```ts
export interface Session {
  id: string;
  connectionId: string;
  connection: Connection;
  status: SessionStatus;
  openedAt: number;
  error?: string;
  tabId: string;  // ADD THIS
}
```

No other changes in this task.

### Task 2: Refactor appStore — per-tab pane layouts
**File:** `src/store/appStore.ts`

Replace global `paneRoot: PaneNode | null` with `tabLayouts: Record<string, PaneNode>`.

**Interface changes:**
- Remove: `paneRoot: PaneNode | null`
- Add: `tabLayouts: Record<string, PaneNode>`
- Rename: `closeSession` → `closeTab` (closes primary + all secondaries)
- Keep: `closePane` (updated logic below)

**`openSession` update:**
Set `tabId = sessionId` on the new Session object.

**`splitPane(sessionId, direction)` update:**
```
tabId = sessions.find(s => s.id === sessionId)?.tabId ?? sessionId
newSessionId = `${connection.id}-${Date.now()}`
newSession.tabId = tabId
baseRoot = tabLayouts[tabId] ?? { type: "leaf", sessionId: tabId }
newRoot = insertSplit(baseRoot, sessionId, direction, newSessionId)
tabLayouts[tabId] = newRoot
```

**`closeTab(primaryId)` (was closeSession):**
```
sessions = sessions.filter(s => s.id !== primaryId && s.tabId !== primaryId)
delete tabLayouts[primaryId]
activeSessionId = (last remaining primary session).id ?? null
```
"Last remaining primary session" = last session where `tabId === id`.

**`closePane(sessionId)` update:**
```
session = sessions.find(s => s.id === sessionId)
tabId = session?.tabId ?? sessionId
isPrimary = sessionId === tabId

if isPrimary:
  // Close entire tab
  sessions = sessions.filter(s => s.id !== sessionId && s.tabId !== sessionId)
  delete tabLayouts[sessionId]
  activeSessionId = (last remaining primary session).id ?? null
else:
  // Remove just this pane leaf
  sessions = sessions.filter(s => s.id !== sessionId)
  current = tabLayouts[tabId]
  newRoot = current ? removeLeaf(current, sessionId) : null
  if newRoot?.type === "split":
    tabLayouts[tabId] = newRoot
  else:
    delete tabLayouts[tabId]  // Collapsed to single pane
  if activeSessionId === sessionId:
    activeSessionId = tabId  // Focus primary
```

**`setPaneRatio(path, ratio)` update:**
```
activeTabId = sessions.find(s => s.id === activeSessionId)?.tabId ?? activeSessionId
if activeTabId && tabLayouts[activeTabId]:
  tabLayouts[activeTabId] = updateRatio(tabLayouts[activeTabId], path, ratio)
```

**Initial state:**
```ts
tabLayouts: {},
paneRoot: undefined  // removed
```

### Task 3: Update App.tsx and SessionTabs.tsx
**Files:** `src/App.tsx`, `src/components/session/SessionTabs.tsx`

**App.tsx changes:**
1. Replace `paneRoot` with `tabLayouts` in store destructure. Also destructure `closeTab`.
2. Derive:
   ```ts
   const activeTabId = activeSessionId
     ? (sessions.find(s => s.id === activeSessionId)?.tabId ?? activeSessionId)
     : null;
   const activeTabLayout = activeTabId ? tabLayouts[activeTabId] : undefined;
   const isSplit = activeTabLayout !== undefined;
   const paneLayout = useMemo(
     () => (activeTabLayout ? computePaneLayout(activeTabLayout) : null),
     [activeTabLayout]
   );
   const leafCount = activeTabLayout ? countLeaves(activeTabLayout) : 0;
   ```
3. Remove the `!isSplit &&` guard — `<SessionTabs />` is always rendered when sessions.length > 0.
4. Panel active/visibility logic:
   ```ts
   const panelStyle = paneLayout?.panelStyles.get(session.id);
   const active = isSplit
     ? panelStyle !== undefined
     : session.id === activeTabId;
   const focused = session.id === activeSessionId;
   ```
5. PaneHeader onClose: call `closePane(sessionId)` (unchanged — already uses closePane).
6. Pass `closeTab` to SessionTabs as needed, or let SessionTabs call it directly.

**SessionTabs.tsx changes:**
1. Add `closeTab` to store destructure (alongside existing `closeSession` removal).
2. Derive `activeTabId`:
   ```ts
   const activeTabId = activeSessionId
     ? (sessions.find(s => s.id === activeSessionId)?.tabId ?? activeSessionId)
     : null;
   ```
3. Filter primary sessions:
   ```ts
   const primarySessions = sessions.filter(s => s.tabId === s.id);
   ```
4. Map `primarySessions` in the tab bar (not all sessions).
5. `active` prop for each Tab: `session.id === activeTabId`.
6. Tab `onClose`: call `closeTab(session.id)` instead of `closeSession(session.id)`.
7. `canSplit`: use `leafCount` (already correct: `countLeaves` of activeTabLayout), `activeSessionId !== null`.
8. Split buttons: keep using `activeSessionId` (splits the currently focused pane).

### Task 4: SSH graceful exit + fix disconnect handlers
**Files:**
- `src-tauri/src/commands/ssh.rs`
- `src/hooks/useSshTerminal.ts`
- `src/hooks/useTrmTerminal.ts`

**ssh.rs changes:**

In the main input loop inside `run_ssh_session`, track whether the break was graceful:

```rust
let mut graceful_exit = false;

loop {
    tokio::select! {
        msg = input_rx.recv() => {
            match msg {
                Some(SshInput::Data(data)) => { ... }
                Some(SshInput::Resize { cols, rows }) => { ... }
                Some(SshInput::Disconnect) | None => {
                    let _ = channel.eof().await;
                    break; // graceful_exit remains false
                }
            }
        }
        _ = close_rx.recv() => {
            graceful_exit = true;
            break;
        }
    }
}
// Return graceful flag somehow — simplest: use a thread-local or return Ok(bool)
```

Change `run_ssh_session` return type to `Result<bool, String>` where `Ok(true)` = graceful, `Ok(false)` = frontend-initiated:

```rust
async fn run_ssh_session(...) -> Result<bool, String> {
  ...
  loop {
    tokio::select! {
      ... SshInput::Disconnect | None => { channel.eof().await; return Ok(false); }
      _ = close_rx.recv() => { return Ok(true); }
    }
  }
  // unreachable, but for compiler:
  Ok(false)
}
```

In the caller (`ssh_connect`):
```rust
match run_ssh_session(&app_clone, &params, &mut input_rx).await {
    Ok(true) => {
        // Graceful exit (user typed exit)
        let _ = app_clone.emit("ssh-status", SshStatusEvent {
            session_id: session_id.clone(),
            status: "closed".into(),
            message: None,
        });
    }
    Ok(false) => {
        // Frontend-initiated disconnect — emit nothing, frontend is already handling it
    }
    Err(e) => {
        let _ = app_clone.emit("ssh-status", SshStatusEvent {
            session_id: session_id.clone(),
            status: "error".into(),
            message: Some(e),
        });
    }
}
```

**useSshTerminal.ts changes:**
1. Replace `closeSession` with `closePane` in store subscription.
2. Add "closed" branch in the ssh-status handler (before "disconnected"):
   ```ts
   if (status === "closed") {
     closePane(sessionId);
   } else if (status === "disconnected") {
     const { behavior, sshDefaults } = useSettingsStore.getState();
     if (behavior.autoReconnect) {
       // ... existing reconnect logic unchanged
     } else {
       closePane(sessionId);  // was closeSession
     }
   } else if (status === "error") {
     // unchanged
   }
   ```

**useTrmTerminal.ts changes:**
1. Replace `closeSession` with `closePane`.
2. On "disconnected": call `closePane(sessionId)` (was `closeSession`).

Note: TRM does not need Rust changes — it already always closes on disconnect (no autoReconnect).
