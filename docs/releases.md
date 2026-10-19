# Releases

The release command requires a clean, synchronized `main` branch, authenticated `gh` CLI access, Bun, and Rust:

```sh
bun run release --patch
bun run release --minor
bun run release --major
```

The command uses SemVer to increment the current synchronized version. PowerShell-style aliases `-BumpPatch`, `-BumpMinor`, and `-BumpMajor` are also accepted. Use `bun run release 1.0.0` for an exact SemVer target, including prereleases such as `1.0.0-rc.1`, or add `--dry-run` to preview the selected version and release branch. Supplying the current exact version resumes an interrupted release after its version PR has already merged.

## What the command does

Run the command from a clean local `main` that exactly matches `origin/main`. It then:

1. Creates a `release/vX.Y.Z` branch, updates the package, Tauri, Cargo, and lockfile versions, runs the application and Rust checks, pushes the branch, and opens a release pull request.
2. Enables squash auto-merge and waits without a fixed timeout for required checks, mergeability, and any approvals configured by repository policy.
3. After GitHub merges the PR, synchronizes local `main` and only then creates and pushes the version tag.
4. Creates or reuses a draft GitHub release, dispatches or reuses `.github/workflows/desktop-release.yml`, waits for the signed Windows, Linux, and macOS bundles and the `latest.json` updater manifest generated from them, and publishes the release when the complete workflow succeeds.

Versions containing a hyphen are published as prereleases. macOS CI builds use ad-hoc signing; configure normal platform signing credentials before presenting the artifacts as trusted production installers.

## Failures and resuming

If local validation fails before a PR exists, the command restores the version files and removes its generated branch automatically. If pull-request checks fail, the PR and remote release branch remain available for inspection and no tag or GitHub release is created. If anything fails after the version PR merges, rerun the current exact version—for example, `bun run release 0.5.0` while `main` is `0.5.0`—to resume from tagging, draft creation, workflow execution, or publication without creating another version PR.

## Updater signing

Updater signing depends on the repository Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep the matching private key backed up securely: changing or losing it prevents installed copies from trusting future updates.

## Retrying the desktop workflow

The workflow's manual **Version tag** input is primarily a retry mechanism. Enter an existing tag such as `v0.4.0` only after a draft GitHub release for that tag already exists. The workflow builds and uploads assets but deliberately leaves the release as a draft; after every matrix job and the final `updater manifest` job succeed, publish it with `gh release edit v0.4.0 --draft=false --latest`. That final job writes `latest.json` once from the uploaded bundles and signatures and fails if any shipped bundle or signature is missing; if only it fails, rerun just that job. Normal releases should use `bun run release`, which performs and watches these steps automatically.

## Linux packages

Linux x64 releases include AppImage, DEB, and RPM packages. Linux ARM64 releases include DEB and RPM packages; ARM64 AppImage generation is omitted because its upstream `linuxdeploy` packaging path is not reliable on the native GitHub runner.
