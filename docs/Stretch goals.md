# SlimRDM — Stretch Goals

Ten candidate features that would give SlimRDM an edge over heavyweight RDM tools
(Devolutions RDM, mRemoteNG) and slick-but-cloud-locked ones (Termius).

**Guiding principle:** every feature below must stay true to SlimRDM's nature —
**lightweight** (no bloat, fast cold start, small binary), **effective** (solves a real
daily pain in the fewest clicks), and **reliable** (predictable, offline-first, your data
stays yours). Features that would drag in a heavy dependency, a mandatory account, or a
background service are deliberately shaped to avoid that.

Effort is a rough T-shirt size: **S** = days, **M** = 1–2 weeks, **L** = 3+ weeks.

## At a glance

| # | Feature | Effort | ROI | Edge |
|---|---------|--------|-----|------|
| 1 | SSH jump hosts (ProxyJump / multi-hop) | M | High | Bastion access without a config-file dance |
| 2 | Integrated SSH tunnels & SOCKS forwarding | M | High | Port-forwarding as first-class UI, not CLI |
| 3 | Encrypted credential vault (master password) | M | High | Portable security without a cloud account |
| 4 | Command palette / quick-connect (Ctrl+K) | S | High | Keyboard-first; connect in <1s |
| 5 | Snippets + broadcast-to-all-panes | S–M | High | Run one command across many sessions |
| 6 | Integrated SFTP file browser | L | High | Transfer files without a second app |
| 7 | Bring-your-own-storage encrypted sync | M | Med–High | Multi-device sync, zero vendor lock-in |
| 8 | Passive connection health indicators | S | Medium | See what's reachable at a glance |
| 9 | Session logging & searchable scrollback | M | Medium | Audit trail / recall without a SIEM |
| 10 | RDP quality-of-life (clipboard, dynamic res, multi-mon) | M–L | High | Embedded RDP that feels native |

---

## 1. SSH jump hosts (ProxyJump / multi-hop)

Let a connection declare one or more bastion hops it must tunnel through before reaching
the target, configured with a simple picker ("connect via →") rather than a hand-edited
`~/.ssh/config`.

- **Level of effort — M.** `russh` can open a direct-tcpip channel through an established
  session, so a hop is "connect to bastion, then open the next hop over that channel."
  The recursion and per-hop credential resolution is the real work; the UI is a dropdown.
- **ROI — High.** Bastion/jump-host access is the default in any serious homelab or
  corporate network. Today users can't reach those hosts at all without external tooling.
- **Edge.** Standard RDM tools support this but bury it in nested "gateway" config; CLI
  users hand-edit `ProxyJump`. Making it a one-click relationship between saved
  connections is both more discoverable and more reliable.

## 2. Integrated SSH tunnels & SOCKS forwarding

Local (`-L`), remote (`-R`), and dynamic SOCKS (`-D`) forwards attached to a connection,
started/stopped from a small panel, with live status.

- **Level of effort — M.** Channel plumbing largely overlaps with #1 (same direct-tcpip
  primitives). Needs a lightweight forward manager and a status surface in the UI.
- **ROI — High.** Tunneling to a database, a web UI, or through a SOCKS proxy is a daily
  need for developers and admins — and a frequent reason people keep a terminal open
  alongside their RDM tool.
- **Edge.** Most lightweight clients make you drop to a shell for this. Presenting forwards
  as toggleable, savable properties of a connection — that reconnect automatically with the
  session — is a genuine differentiator that fits the "effective, fewer clicks" ethos.

## 3. Encrypted credential vault (master password)

Encrypt `slimrdm.json` (and any keyring-fallback secrets) at rest behind a master password,
unlocking the vault at app launch. Complements — not replaces — the OS keyring.

- **Level of effort — M.** AES-GCM + Argon2id key derivation in Rust is well-trodden. The
  work is lifecycle: unlock flow, re-lock on idle, key rotation, and a clean migration for
  existing unencrypted stores. Already on the roadmap.
- **ROI — High.** Closes the one obvious security gap for users who don't fully trust the
  host, run portable installs, or sync their store (see #7). Table-stakes for anyone
  evaluating SlimRDM against enterprise tools.
- **Edge.** Devolutions gates real vaulting behind paid/cloud tiers. A free, local,
  cloud-free encrypted vault is squarely on-brand: reliable and private by default.

## 4. Command palette / quick-connect (Ctrl+K)

A fuzzy launcher: hit `Ctrl+K`, type a few characters of a host/group/tag, Enter to
connect. Extend it to actions (open settings, split pane, run a snippet).

- **Level of effort — S.** Pure frontend over existing state — a fuzzy filter, a modal, and
  a command registry. No backend changes.
- **ROI — High.** Enormous perceived-speed and power-user payoff for very little code. Turns
  "hunt the sidebar" into "connect in under a second."
- **Edge.** This is the interaction pattern power users love in modern tools (VS Code,
  Raycast) and that legacy RDM software conspicuously lacks. It reinforces the "lightweight
  and fast" identity better than almost anything else on this list.

## 5. Snippets + broadcast-to-all-panes

A library of reusable command snippets, plus a "broadcast input" toggle that types into
**every** SSH pane in the current tab at once (with clear visual indication it's active).

- **Level of effort — S–M.** Snippets are stored strings + a picker (pairs naturally with
  #4). Broadcast reuses the existing multi-pane split model — fan one input stream out to
  N terminals; the guardrails (visual warning, per-pane opt-out) are the careful part.
- **ROI — High.** "Run this on all these boxes" is the single biggest time-saver for anyone
  managing fleets, and snippets kill repetitive typing.
- **Edge.** Broadcast/multi-exec is a headline feature people pay for in SecureCRT/iTerm.
  SlimRDM already has split panes — layering broadcast on top is a small step to a
  marquee capability.

## 6. Integrated SFTP file browser

A dual-pane file browser over the active SSH connection: browse, drag-and-drop upload/
download, quick edit-in-place of small files.

- **Level of effort — L.** SFTP transport, a virtualized file tree, transfer queue with
  progress/resume, and permission/error handling. The largest item here — worth scoping as
  its own spec.
- **ROI — High.** Removes the need for a separate WinSCP/FileZilla/Cyberduck. "Terminal +
  files in one window" is a strong reason to make SlimRDM the daily driver.
- **Edge.** Termius does this behind a subscription; mRemoteNG doesn't do it at all. A free,
  embedded SFTP browser is a compelling differentiator — but keep it optional/lazy-loaded so
  it never taxes the lightweight baseline.

## 7. Bring-your-own-storage encrypted sync

Sync the (encrypted, per #3) connection store across machines using storage the user
already owns — a Git repo or a synced folder (Dropbox/OneDrive/Syncthing) — with no SlimRDM
account or server.

- **Level of effort — M.** Depends on #3 for the encryption boundary. Core work is a
  conflict-aware merge (last-write-wins with a clear diff prompt) and a pluggable storage
  backend. Git-remote first is the simplest reliable option.
- **ROI — Med–High.** Multi-device users currently export/import JSON by hand. Real sync is
  a retention feature, and "no vendor cloud" is a trust selling point.
- **Edge.** Every competitor either offers no sync or forces you onto *their* cloud.
  Encrypted, self-hosted, zero-account sync is uniquely aligned with SlimRDM's privacy-first,
  reliable ethos.

## 8. Passive connection health indicators

A subtle reachability dot next to each connection in the sidebar (TCP-connect probe on the
target port, throttled and off by default per group), so you can see what's up before you
click.

- **Level of effort — S.** A cheap async TCP-connect probe with a sensible interval and
  backoff; a status field surfaced in the sidebar. No new heavy dependencies.
- **ROI — Medium.** Saves the "click, wait, timeout, sigh" loop and helps triage outages at
  a glance. Nice-to-have rather than must-have.
- **Edge.** Big RDM suites bolt on full monitoring dashboards that bloat the app. A single,
  quiet, opt-in health dot is the *lightweight* interpretation — signal without the bloat.

## 9. Session logging & searchable scrollback

Optionally record terminal output per session to a local log, with in-app search across a
session's scrollback and across saved logs.

- **Level of effort — M.** Tee the PTY stream to a rotating log (rotation already exists for
  app logs), plus a search UI over xterm's buffer and stored files. Redaction/limits need
  care.
- **ROI — Medium.** "What did I run last Tuesday?" and lightweight audit needs are common;
  compliance-minded users value a local trail without standing up a SIEM.
- **Edge.** Positions SlimRDM for regulated/ops environments while staying local-only and
  private — logging that respects the "your data stays yours" principle.

## 10. RDP quality-of-life (clipboard, dynamic resolution, multi-monitor)

Round out the embedded `ironrdp` experience: bidirectional clipboard sync, dynamic
resolution that follows window resize, and (stretch) multi-monitor spanning.

- **Level of effort — M–L.** `ironrdp` exposes the virtual channels (CLIPRDR) and
  display-control primitives, but wiring clipboard, resize negotiation, and especially
  multi-monitor is substantial and needs careful cross-platform testing.
- **ROI — High.** Embedded pure-Rust RDP is SlimRDM's headline differentiator; the gap
  today versus `mstsc` is exactly these ergonomics. Closing it makes the RDP story credible
  for daily use.
- **Edge.** No other lightweight, Wayland-compatible, no-`xfreerdp` client renders RDP to
  canvas. Making that experience feel native — not just functional — cements a capability
  competitors literally cannot match on Linux.

---

## Suggested sequencing

A pragmatic order that front-loads high-ROI, low-effort wins and respects dependencies:

1. **Quick wins first:** #4 Command palette, #8 Health indicators, #5 Snippets/broadcast —
   small, high-visibility, mostly frontend.
2. **Security foundation:** #3 Encrypted vault — unlocks #7 and is table-stakes.
3. **SSH power features:** #1 Jump hosts → #2 Tunnels (shared channel plumbing).
4. **Sync:** #7 — once the vault exists.
5. **Bigger bets, own specs:** #6 SFTP browser, #9 Session logging, #10 RDP QoL.

Each of these deserves its own brainstorm → spec → plan cycle before implementation; this
document is the menu, not the design.
