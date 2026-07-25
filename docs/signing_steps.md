# Update signing — what changed and what's left

## Why

A security audit (`audit.txt` at repo root, commit `4cb79e6`) flagged unsigned
self-updates as the one High-severity finding:

> `src-tauri/src/commands/updates.rs` downloads and executes installers. SHA-256
> validation is optional, while the release workflow generates no `.sha256`
> file. A compromised GitHub release could deliver executable code.

SHA-256 alone doesn't fix this — whoever compromises a release can just ship a
matching malicious `.sha256` alongside it. The real fix is a signature backed
by a private key that never touches GitHub, so a compromised release (or a
compromised `GITHUB_TOKEN`) still can't produce something the app will install.

## What changed

Four commits, all local, nothing pushed yet:

1. **`fix(security): require Minisign signature verification for self-updates`**
   `download_and_install_update` now takes a required `signature` argument and
   verifies it (via the `minisign-verify` crate) against an embedded public key
   before writing anything to disk. `check_for_updates` only offers an in-app
   install when a `.sig` sidecar is published for the release asset — no
   sidecar means the UI falls back to "View Release" instead of auto-installing.
2. **`refactor: fix clippy lints ahead of mandatory CI gate`** — mechanical
   cleanup, no behavior change, done so the new Clippy gate (below) starts clean.
3. **`chore(deps): npm audit fix`** — resolved an unrelated high-severity
   `postcss` advisory found while wiring up the new `npm audit` CI gate.
4. **`ci: add mandatory test/lint/audit gates`** — new `checks.yml` /
   `ci.yml` run `cargo test`, `cargo clippy -D warnings`, `cargo audit`,
   `tsc --noEmit`, and `npm audit` on every push/PR; `release.yml`'s build
   matrix now `needs: checks`, so a tag push can't publish without passing.
   Also added a "Sign release installers" step to `release.yml` that runs
   `tauri signer sign` on each platform's installer and uploads the `.sig` as
   a release asset.

None of this does anything yet — the signing step in CI needs a private key,
and nothing has been configured.

## The key situation

I generated a Minisign keypair locally (via `npx tauri signer generate`) to
build and test the verification code end-to-end — the public half is what's
now embedded in `updates.rs`:

```
const UPDATE_PUBLIC_KEY: &str = "RWTrdjD/xZnfj9OtLtKJwGotGDdN8+1OiWXxB7lyK/OQk7gOX1Mjqdtl";
```

The private key + password live only on my machine
(`~/.tauri/slimrdm-updater.key` / `.key.password`), never committed, never
pasted into chat. **That's a working example, not a decision about who should
hold the real signing key.** Whoever's key this is can sign builds that get
auto-installed on every user's machine — that should be whoever actually
controls the repo and its release pipeline long-term. Pick one:

### Option A — your friend generates his own key (recommended)

Cleaner: no private key ever changes hands between people.

1. He runs, on his own machine:
   ```
   npx tauri signer generate --ci -w ~/.tauri/slimrdm-updater.key
   ```
   (omit `--ci` to be prompted for a password interactively instead of
   generating one; either way, **save the password** — it's needed to sign
   every future release and isn't recoverable.)
2. He backs up both the private key file and its password somewhere durable
   (password manager, not the repo, not Slack/email).
3. He replaces `UPDATE_PUBLIC_KEY` in `src-tauri/src/commands/updates.rs`
   with the public key printed by step 1, and commits that change.
4. He sets the two GitHub Actions repo secrets (see below) from his own key.

### Option B — reuse the key I already generated

Fewer steps, but means the private key has to move from my machine to his
through some channel — do this out-of-band (not through this chat), e.g. a
password manager's secure share feature. No code change needed since
`UPDATE_PUBLIC_KEY` already matches this key.

## Setting the GitHub secrets (either option)

Whoever ends up holding the private key runs this themselves — the values
should never pass through an AI assistant's context or a shared chat:

```
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo GnomishGames/slimRDM < path/to/slimrdm-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo GnomishGames/slimRDM < path/to/slimrdm-updater.key.password
```

Using `<` (stdin redirect) instead of pasting the value as a CLI argument
keeps it out of shell history and process listings.

## Verifying it worked

After the secrets are set and this branch is merged, cut a release tag and
check that:
- The `checks` job passes before `release` starts (enforced by `needs:`).
- Each platform's release page has, alongside the installer, a matching
  `<installer>.sig` file.
- The app's in-app updater shows "Install" (not "View Release") when a newer
  signed version is available.
