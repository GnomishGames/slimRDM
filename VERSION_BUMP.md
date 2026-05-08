# Version Bump Checklist

## Version Files to Update

- [ ] `package.json` — field: `version`
- [ ] `src-tauri/tauri.conf.json` — field: `version`
- [ ] `src-tauri/Cargo.toml` — field: `version` in `[package]`

## Pre-Release Tasks

- [ ] Run tests: `npm run tauri build` (or test command from repo)
- [ ] Update `CHANGELOG.md` with changes since last release
- [ ] Verify all new dependencies are committed
- [ ] Icon updated (if视觉 changes)
- [ ] Verify tag points to correct commit with updated versions

## Tagging & Push

```bash
# 1. Update versions in all 3 files above
# 2. Commit version bump
git add -A && git commit -m "Bump version to X.Y.Z"

# 3. Create tag (after any other release commits)
git tag -a vX.Y.Z -m "Version X.Y.Z"

# 4. Push tag to origin
git push origin vX.Y.Z
```

## Verify Tag Contents

```bash
# Ensure tag has correct version
git show vX.Y.Z:package.json | grep '"version"'
git show vX.Y.Z:src-tauri/Cargo.toml | grep '^version'
```