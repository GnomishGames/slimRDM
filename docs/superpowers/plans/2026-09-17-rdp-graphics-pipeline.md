# RDP Graphics Pipeline (EGFX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make slimRDM render RDP hosts that paint only through the graphics pipeline (MS-RDPEGFX), such as `spftp`, which today produce a live, logged-on session with a permanently blank canvas.

**Architecture:** Upgrade ironrdp 0.14 → 0.17 first and land it on its own commit, so any regression in the four behaviours CLAUDE.md protects is bisectable. Then advertise `SUPPORT_DYN_VC_GFX_PROTOCOL` (ironrdp never sets it, so this needs a vendored connector patch), register `DrdynvcClient` carrying a `GraphicsPipelineClient` as a static channel, and blit the RGBA bitmap updates it decodes into the existing `DecodedImage` so the session loop's frame pacing and dirty-region union are reused unchanged.

**Tech Stack:** Rust, ironrdp 0.17 (`ironrdp-egfx` 0.3, `ironrdp-dvc` 0.8, `ironrdp-connector` 0.10, `ironrdp-session` 0.11), Tauri 2, React 18.

**Spec:** No separate spec document. The diagnosis this plan implements is recorded in the memory note `egfx-blank-screen` and summarised under "Evidence" below.

## Evidence this plan rests on

Captured 2026-09-17 from `spftp` (10.1.2.154):

- FreeRDP (via KRDC) renders the host. Its WLog trace shows **every** update arriving as `gdi_SurfaceCommand` with `RDPGFX_CODECID_CLEARCODEC` (161) and `RDPGFX_CODECID_CAPROGRESSIVE` (13), over the `Microsoft::Windows::RDS::Graphics` dynamic virtual channel.
- FreeRDP's client core data sets `RNS_UD_CS_SUPPORT_DYNVC_GFX_PROTOCOL`. slimRDM's does not.
- slimRDM's session reaches `Connected with success`, receives logon info and clipboard traffic, and never receives a single graphics PDU — 4,750 bytes for an entire session.
- Three alternative causes were tested and eliminated: slow-path graphics (no graphics PDUs of any kind arrive), RemoteFX advertisement (advertising an empty codec list changed nothing), and the 16-vs-32 bpp contradiction (a vendored connector echoing the server's 16 changed nothing).

## Global Constraints

- **No React StrictMode.** Do not re-add it.
- **Sidebar ordering** lives only in `src/utils/ordering.ts`. Do not add sorting to Rust `list_*` commands or appStore mutations.
- **Do not send `id` from the frontend** when creating connections/groups.
- **Tauri v2 capabilities** for any new frontend permission go in `src-tauri/capabilities/default.json`.
- CI gates on: `cargo test`, `cargo clippy -p slimrdm --lib --bins -- -D warnings`, `cargo audit`, `npx tsc --noEmit`, `npm test`, `npm audit --audit-level=high`. All must pass before each commit.
- `pointer_software_rendering: false` and `enable_server_pointer: true` must stay as they are — the remote cursor depends on them (CLAUDE.md).
- Vendored crates live in `src-tauri/vendor/<crate>` and are wired through `[patch.crates-io]`, following the existing `vendor/russh` precedent.

---

### Task 1: Upgrade ironrdp 0.14 → 0.17

Known breakage, measured by compiling the upgrade in a throwaway worktree: **7 errors, all in `src-tauri/src/commands/rdp.rs`**. No breakage in the cursor, clipboard, modifier or EOF code.

**Files:**
- Modify: `src-tauri/Cargo.toml` (dependency versions)
- Modify: `src-tauri/src/commands/rdp.rs` (Config fields, ActiveStage construction, frame types)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ConnectionResult` with the new fields `message_channel_id: Option<u16>`, `share_id: u32`, `compression_type: Option<CompressionType>`, `activation_factory: ConnectionActivationFactory` — Tasks 3 and 4 depend on these.

- [ ] **Step 1: Bump the dependencies**

In `src-tauri/Cargo.toml`:

```toml
ironrdp = { version = "0.17", features = ["connector", "session", "graphics", "pdu", "cliprdr", "core", "dvc", "svc"] }
ironrdp-cliprdr = "0.7"
ironrdp-tokio = { version = "0.10", features = ["reqwest"] }
```

- [ ] **Step 2: Run the build to see the expected failures**

Run: `cd src-tauri && cargo check --message-format short 2>&1 | grep -E "^error"`
Expected: 7 errors — `E0063` missing `Config` fields, `E0599` no `ActiveStage::new`, and five `E0277` `[u8]` sizing errors.

- [ ] **Step 3: Add the four new Config fields**

`Config` in connector 0.10 gained `alternate_shell`, `work_dir`, `compression_type` and `multitransport_flags`. Add to the `Config { .. }` literal in `run_rdp_inner`:

```rust
        alternate_shell: String::new(),
        work_dir: String::new(),
        // Bulk compression is negotiated; None leaves it off, matching 0.14 behaviour.
        compression_type: None,
        multitransport_flags: None,
```

- [ ] **Step 4: Replace `ActiveStage::new` with the builder**

`ActiveStage::new(connection_result)` is gone. In `run_session`:

```rust
    let mut active_stage = ironrdp::session::ActiveStageBuilder {
        static_channels: connection_result.static_channels,
        user_channel_id: connection_result.user_channel_id,
        io_channel_id: connection_result.io_channel_id,
        message_channel_id: connection_result.message_channel_id,
        share_id: connection_result.share_id,
        compression_type: connection_result.compression_type,
        enable_server_pointer: connection_result.enable_server_pointer,
        pointer_software_rendering: connection_result.pointer_software_rendering,
    }
    .build();
```

Note `DecodedImage::new` still takes `connection_result.desktop_size.width/height`, so read the desktop size **before** the builder moves `connection_result`'s fields.

- [ ] **Step 5: Fix the five `[u8]` sizing errors**

These are `writer.write_all(&frame)` / `write_all(&bytes)` calls where the payload type changed. At each reported line, borrow as a slice explicitly:

```rust
writer.write_all(frame.as_ref()).await.map_err(|e| format!("Write error: {e}"))?;
```

Apply to every reported site (the `ResponseFrame` write, the resize write, and the three cliprdr writes). If a site reports a different concrete type, match it rather than forcing `as_ref`.

- [ ] **Step 6: Verify it compiles and the suite passes**

Run: `cd src-tauri && cargo check --all-targets && cargo test && cargo clippy -p slimrdm --lib --bins -- -D warnings`
Expected: clean; 57 tests pass.

- [ ] **Step 7: Exercise the four protected behaviours live**

Run `npm run tauri dev`, connect to a **working** RDP host (not spftp) and confirm, because these are exactly what the upgrade risks:
1. Remote cursor changes shape over a window edge and a text field.
2. Ctrl+C interrupts a running command in a remote shell (does not type `c`).
3. `exit` in the remote shell closes the tab.
4. Copy/paste both directions.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/commands/rdp.rs
git commit -m "chore(deps): upgrade ironrdp 0.14 to 0.17"
```

---

### Task 2: Advertise the graphics pipeline

ironrdp defines `ClientEarlyCapabilityFlags::SUPPORT_DYN_VC_GFX_PROTOCOL = 0x0100` in `ironrdp-pdu` but **no crate ever sets it**, so a server never opens the `Microsoft::Windows::RDS::Graphics` channel. This task vendors the connector and sets it, following the `vendor/russh` precedent.

**Files:**
- Create: `src-tauri/vendor/ironrdp-connector/` (copy of the 0.10.0 crate source)
- Modify: `src-tauri/vendor/ironrdp-connector/src/connection.rs` (~line 836)
- Modify: `src-tauri/Cargo.toml` (`[patch.crates-io]`)

**Interfaces:**
- Consumes: Task 1's upgraded tree.
- Produces: a client core data that advertises the graphics pipeline — Task 3's channel never opens without it.

- [ ] **Step 1: Vendor the crate**

```bash
cd src-tauri
cp -r ~/.cargo/registry/src/*/ironrdp-connector-0.10.0 vendor/ironrdp-connector
chmod -R u+w vendor/ironrdp-connector
```

- [ ] **Step 2: Set the flag**

In `vendor/ironrdp-connector/src/connection.rs`, in the `early_capability_flags` block:

```rust
                    let mut early_capability_flags = ClientEarlyCapabilityFlags::VALID_CONNECTION_TYPE
                        | ClientEarlyCapabilityFlags::SUPPORT_ERR_INFO_PDU
                        | ClientEarlyCapabilityFlags::STRONG_ASYMMETRIC_KEYS
                        | ClientEarlyCapabilityFlags::SUPPORT_NET_CHAR_AUTODETECT
                        // PATCH (slimRDM): upstream never advertises the graphics
                        // pipeline, so a server running the WDDM display driver has
                        // no way to send graphics at all and the session renders
                        // nothing. See docs/superpowers/plans/2026-09-17-rdp-graphics-pipeline.md
                        | ClientEarlyCapabilityFlags::SUPPORT_DYN_VC_GFX_PROTOCOL
                        | ClientEarlyCapabilityFlags::SUPPORT_SKIP_CHANNELJOIN;
```

- [ ] **Step 3: Wire the patch**

In `src-tauri/Cargo.toml`:

```toml
[patch.crates-io]
russh = { path = "vendor/russh" }
# Upstream never advertises SUPPORT_DYN_VC_GFX_PROTOCOL; see Task 2 of the
# graphics-pipeline plan.
ironrdp-connector = { path = "vendor/ironrdp-connector" }
```

- [ ] **Step 4: Verify the patch is live**

Run: `cd src-tauri && cargo check && grep -A2 '^name = "ironrdp-connector"' Cargo.lock`
Expected: compiles, and the lock entry has **no** `source = "registry+..."` line.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/vendor/ironrdp-connector src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "fix(rdp): advertise the graphics pipeline in client core data"
```

---

### Task 3: Render graphics pipeline updates

**Files:**
- Create: `src-tauri/src/commands/egfx.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod egfx;`)
- Modify: `src-tauri/src/commands/rdp.rs` (register the channel, drain updates)
- Modify: `src-tauri/Cargo.toml` (add `ironrdp-egfx = "0.3"`, `ironrdp-dvc = "0.8"`)

**Interfaces:**
- Consumes: Task 2's advertised flag; Task 1's `ActiveStageBuilder`.
- Produces: `egfx::SurfaceUpdates` (a cloneable handle) with `fn drain(&self) -> Vec<egfx::SurfaceUpdate>`, and `egfx::SurfaceUpdate { x: u32, y: u32, width: u16, height: u16, rgba: Vec<u8> }`.

- [ ] **Step 1: Write the failing test for the update sink**

Create `src-tauri/src/commands/egfx.rs` with a test first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drain_returns_updates_in_order_and_empties_the_sink() {
        let sink = SurfaceUpdates::default();
        sink.push(SurfaceUpdate { x: 1, y: 2, width: 3, height: 4, rgba: vec![0; 48] });
        sink.push(SurfaceUpdate { x: 5, y: 6, width: 1, height: 1, rgba: vec![9; 4] });

        let drained = sink.drain();

        assert_eq!(drained.len(), 2);
        assert_eq!((drained[0].x, drained[0].y), (1, 2));
        assert_eq!((drained[1].x, drained[1].y), (5, 6));
        assert!(sink.drain().is_empty(), "drain must empty the sink");
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd src-tauri && cargo test egfx`
Expected: FAIL — `SurfaceUpdates` not found.

- [ ] **Step 3: Implement the sink and the handler**

```rust
//! Graphics pipeline (MS-RDPEGFX) updates.
//!
//! Hosts running the WDDM RDP display driver paint only through this channel —
//! they advertise the legacy codecs but never produce them, so without it the
//! session is live and the canvas stays blank.

use std::sync::{Arc, Mutex};

use ironrdp_egfx::client::{BitmapUpdate, GraphicsPipelineHandler};

/// One decoded rectangle, in the framebuffer's coordinate space.
pub struct SurfaceUpdate {
    pub x: u32,
    pub y: u32,
    pub width: u16,
    pub height: u16,
    /// RGBA, 4 bytes per pixel, row-major, `width * height * 4` long.
    pub rgba: Vec<u8>,
}

/// Shared hand-off from the channel (which owns the handler) to the session loop.
#[derive(Clone, Default)]
pub struct SurfaceUpdates(Arc<Mutex<Vec<SurfaceUpdate>>>);

impl SurfaceUpdates {
    pub fn push(&self, update: SurfaceUpdate) {
        self.0.lock().unwrap().push(update);
    }

    pub fn drain(&self) -> Vec<SurfaceUpdate> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

pub struct Handler {
    updates: SurfaceUpdates,
    session_id: String,
}

impl Handler {
    pub fn new(updates: SurfaceUpdates, session_id: String) -> Self {
        Self { updates, session_id }
    }
}

impl GraphicsPipelineHandler for Handler {
    fn on_bitmap_updated(&mut self, update: &BitmapUpdate) {
        if update.data.is_empty() {
            return;
        }
        self.updates.push(SurfaceUpdate {
            x: update.destination_rectangle.left,
            y: update.destination_rectangle.top,
            width: update.width,
            height: update.height,
            rgba: update.data.clone(),
        });
    }

    fn on_reset_graphics(&mut self, width: u32, height: u32) {
        log::debug!("[rdp {}] egfx reset graphics {width}x{height}", self.session_id);
    }
}
```

- [ ] **Step 4: Run the test**

Run: `cd src-tauri && cargo test egfx`
Expected: PASS.

- [ ] **Step 5: Register the channel on the connector**

In `rdp.rs`, beside the existing cliprdr registration:

```rust
    let egfx_updates = crate::commands::egfx::SurfaceUpdates::default();
    let graphics = ironrdp_egfx::client::GraphicsPipelineClient::new(
        Box::new(crate::commands::egfx::Handler::new(
            egfx_updates.clone(),
            params.session_id.clone(),
        )),
        // No H.264 decoder: AVC capability sets are filtered out automatically,
        // leaving ClearCodec and Progressive, which is what these hosts send.
        None,
    );
    let drdynvc = ironrdp_dvc::DrdynvcClient::new().with_dynamic_channel(graphics);
    let connector = connector.with_static_channel(drdynvc);
```

Pass `egfx_updates.clone()` through `finish` into `run_session`.

- [ ] **Step 6: Blit drained updates into the framebuffer**

In `run_session`, immediately after `active_stage.process(..)` returns (the EGFX data arrives inside those PDUs, so the handler has already run):

```rust
        for update in egfx_updates.drain() {
            let stride = image.width() as usize * 4;
            let dst = image.data_mut();
            for row in 0..update.height as usize {
                let src_start = row * update.width as usize * 4;
                let dst_start = (update.y as usize + row) * stride + update.x as usize * 4;
                let len = update.width as usize * 4;
                if dst_start + len <= dst.len() && src_start + len <= update.rgba.len() {
                    dst[dst_start..dst_start + len]
                        .copy_from_slice(&update.rgba[src_start..src_start + len]);
                }
            }
            let region = (
                update.x as u16,
                update.y as u16,
                update.x as u16 + update.width - 1,
                update.y as u16 + update.height - 1,
            );
            pending_dirty = Some(match pending_dirty {
                None => region,
                Some((l, t, r, b)) => (l.min(region.0), t.min(region.1), r.max(region.2), b.max(region.3)),
            });
        }
```

If `DecodedImage` exposes no `data_mut()`, keep slimRDM's own `Vec<u8>` framebuffer alongside it for EGFX surfaces and emit from that — check the 0.11 API before writing this step's final form.

- [ ] **Step 7: Verify against both kinds of host**

Run `npm run tauri dev`. Connect to `spftp`: the desktop must paint and track mouse/keyboard. Connect to a modern host: it must still paint (it will now use EGFX too) with the cursor, clipboard and modifier behaviours from Task 1 Step 7 intact.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/egfx.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/rdp.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(rdp): render graphics pipeline (EGFX) surface updates"
```

---

### Task 4: Handle the server's Deactivate All

`ActiveStageOutput::DeactivateAll` is currently dropped by `_ => {}` in the session loop. A server sends it when a client reconnects to an existing session; until the client redoes the capability exchange the server sends no graphics, which freezes the display exactly like the EGFX symptom. Task 1 makes this tractable: `ConnectionResult::activation_factory` exists for precisely this.

**Files:**
- Modify: `src-tauri/src/commands/rdp.rs`

**Interfaces:**
- Consumes: `connection_result.activation_factory` from Task 1.

- [ ] **Step 1: Keep the factory alive for the session**

Before `connection_result` is consumed by the builder in `run_session`, bind `let activation_factory = connection_result.activation_factory;`.

- [ ] **Step 2: Drive the reactivation sequence**

Replace the silent `_ => {}` with an explicit arm:

```rust
                ActiveStageOutput::DeactivateAll(mut sequence) => {
                    // The server tore down the activation — usually because this
                    // client reconnected to an existing session. Until the
                    // capability exchange is redone it sends no graphics at all.
                    log::debug!("[rdp {session_id}] server deactivated; reactivating");
                    let result = rdp_tokio::connect_finalize_reactivation(
                        &mut sequence,
                        &mut upgraded_framed,
                    )
                    .await
                    .map_err(|e| format!("Reactivation failed: {e}"))?;
                    image = DecodedImage::new(
                        PixelFormat::RgbA32,
                        result.desktop_size.width,
                        result.desktop_size.height,
                    );
                }
```

Check the exact reactivation entry point in `ironrdp-async` 0.10 before writing this step's final form — it is the function that drives a `ConnectionActivationSequence` to completion over an existing framed stream. The writer/reader are split at this point, so this arm may need the loop restructured to keep the framed stream whole, or to use the factory to build a fresh sequence.

- [ ] **Step 3: Verify**

Connect to `spftp` with slimRDM, then connect to the same host with KRDC (which takes the session over), then reconnect with slimRDM. The reconnect must paint rather than showing a blank canvas.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/rdp.rs
git commit -m "fix(rdp): reactivate when the server deactivates the session"
```

---

### Task 5: Document the TLS fallback and the graphics pipeline in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (Gotchas section)

- [ ] **Step 1: Add the two entries**

```markdown
**Legacy TLS fallback** — some Windows hosts offer only CBC cipher suites and a
SHA-1 signed RDP certificate, which rustls cannot negotiate at all, so the server
resets the socket mid-handshake. A refused handshake is retried once over OpenSSL
at `set_security_level(0)` (`src-tauri/src/commands/legacy_tls.rs`). Level 0 is
load-bearing for a non-obvious reason: it is what makes OpenSSL advertise
`rsa_pkcs1_sha1`, without which a SHA-1-certificate server has nothing it can
present. CBC suites themselves are fine at level 2. The cipher list deliberately
excludes the broken families — forcing this path costs an attacker only a TCP
reset.

**Graphics pipeline (EGFX)** — hosts running the WDDM RDP display driver paint
*only* through `Microsoft::Windows::RDS::Graphics`; they advertise the legacy
codecs but never produce them, so a client without EGFX gets a live session and a
blank canvas. ironrdp defines `SUPPORT_DYN_VC_GFX_PROTOCOL` but never sets it,
which is why `vendor/ironrdp-connector` exists.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the legacy TLS fallback and EGFX requirement"
```

---

## Self-Review

**Spec coverage:** The evidence section's three findings map to Tasks 2+3 (flag and channel), Task 1 (prerequisite upgrade), and Task 4 (the reactivation gap found alongside). The eliminated hypotheses are recorded so no task re-tests them.

**Placeholders:** Two steps (Task 3 Step 6, Task 4 Step 2) carry an explicit "check the API before writing the final form" caveat rather than a fabricated signature — `DecodedImage::data_mut` and the reactivation entry point were not verified against the 0.11/0.10 sources while writing this plan. Every other code block is copied from verified signatures. Resolve those two by reading the crate source, not by guessing.

**Type consistency:** `SurfaceUpdates`/`SurfaceUpdate` are defined in Task 3 Step 3 and used in Steps 1, 5 and 6 with matching field names and types. `ActiveStageBuilder`'s fields match `ConnectionResult`'s exactly as of connector 0.10 / session 0.11.
