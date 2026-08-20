# Update signing

## Why

A security audit (`audit.txt` at repo root, commit `4cb79e6`) flagged unsigned
self-updates as the one High-severity finding:

> `src-tauri/src/commands/updates.rs` downloads and executes installers. SHA-256
> validation is optional, while the release workflow generates no `.sha256`
> file. A compromised GitHub release could deliver executable code.

SHA-256 alone doesn't fix this — whoever compromises a release can just ship a
matching malicious `.sha256` alongside it. The real fix is a signature backed by
a private key that never touches GitHub, so a compromised release (or a
compromised `GITHUB_TOKEN`) still can't produce something the app will install.
The `.sha256` sidecars are published too, but only as a corruption check behind
the signature, and as something users can check by hand after a manual download.

## Current state

| | |
|---|---|
| Key in use | Minisign `6090565b549ea78f`, embedded as `UPDATE_PUBLIC_KEY` in `src-tauri/src/commands/updates.rs` |
| Private half | maintainer's password manager, plus the two GitHub Actions secrets below — nowhere else |
| First signed release | 1.7.8 |
| Retired key | `eb7630ffc599df8f` — the placeholder generated while building the feature, embedded in 1.7.7 only |

1.7.7 is the only build carrying the retired key and its private half was never
held by the maintainer, so 1.7.7 cannot verify any later release: it is
withdrawn in favour of installing 1.7.8 directly. Releases 1.7.6 and earlier
have no update verification at all and upgrade normally.

CI does the signing in `release.yml`'s *Sign and checksum release installers*
step: `tauri signer sign` per installer, a `sha256sum` / `shasum -a 256` sidecar
beside it, and both uploaded to the release. The step fails the job if the
bundle globs match nothing, so a changed bundle layout can't quietly publish
unsigned installers.

## Setting the GitHub secrets

The key holder runs this themselves — the values should never pass through an AI
assistant's context or a shared chat:

```
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo GnomishGames/slimRDM < ~/.tauri/slimrdm-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo GnomishGames/slimRDM
```

Using `<` (stdin redirect) instead of pasting the value as a CLI argument keeps
it out of shell history and process listings.

**Do not base64-encode the key file.** `tauri signer generate` already writes
`~/.tauri/slimrdm-updater.key` as a single-line base64 blob, and
`tauri signer sign` base64-*decodes* whatever `TAURI_SIGNING_PRIVATE_KEY`
contains before expecting a Minisign key box that starts with
`untrusted comment:`. Encoding it a second time yields:

```
Error incorrect updater private key password: Missing comment in secret key
```

which names the password but is really a key-format error. This cost a full
release run on 2026-08-19.

## Rotating the key

Every installed build verifies against the public key compiled into *that*
build, so rotation strands every existing install: they reject the new
signatures and can only move forward by reinstalling by hand. It is not a
routine change. When it is unavoidable:

1. `npx tauri signer generate -w ~/.tauri/slimrdm-updater.key` (omit `--ci` to
   choose the password interactively). Back up the key file **and** its
   password durably — neither is recoverable.
2. Replace `UPDATE_PUBLIC_KEY` in `src-tauri/src/commands/updates.rs`.
3. Regenerate the test fixture, or `cargo test` fails and the `checks` job
   blocks the release before it ever builds:
   ```
   printf '%s' 'slimrdm-update-signature-test-fixture' > fixture.bin
   npx tauri signer sign -f ~/.tauri/slimrdm-updater.key fixture.bin
   ```
   Paste `fixture.bin.sig`'s contents into `FIXTURE_SIGNATURE_B64`, and move the
   previous value to `RETIRED_KEY_SIGNATURE_B64` so the rotation keeps its own
   regression test.
4. Reset both GitHub secrets from the new key.
5. Say in `CHANGELOG.md` which versions can no longer auto-update.

## Verifying a release

Each installer on the release page should have both a `<installer>.sig` and a
`<installer>.sha256` beside it, and the app's updater should offer *Install*
rather than *View Release*. To check a published asset by hand (`apt install
minisign`) — note the `.sig` assets are base64-wrapped, so unwrap first:

```
base64 -d SlimRDM_1.7.8_x64-setup.exe.sig > sig.minisig
minisign -Vm SlimRDM_1.7.8_x64-setup.exe -x sig.minisig \
  -P "$(base64 -d ~/.tauri/slimrdm-updater.key.pub | sed -n 2p)"
sha256sum -c SlimRDM_1.7.8_x64-setup.exe.sha256
```

A signature that verifies here but is rejected by the app means the embedded
`UPDATE_PUBLIC_KEY` and the CI signing key have drifted apart.
