## Summary

<!-- What changed in this PR? Keep it short and specific. -->

## PR type

<!-- Check exactly one. PRs outside these types are not accepted unless explicitly approved. -->

- [ ] Translation/localization only
- [ ] Critical bug fix
- [ ] Approved feature/change

## Affected area

<!-- Check every area affected by this PR. -->

- [ ] Shared web app
- [ ] Browser / PWA
- [ ] Playback
- [ ] Audio tracks
- [ ] Subtitles
- [ ] Focus / Keyboard navigation
- [ ] UI / Layout
- [ ] Resume / Watch progress
- [ ] Continue Watching
- [ ] Next Episode / Auto-play
- [ ] Build / Deployment
- [ ] Documentation
- [ ] Other

## Why

<!-- Why is this change needed? Explain the critical bug, localization update, or approved change. -->

## Issue or approval

<!-- Required for critical bug fixes and approved changes. Link the bug issue or approved feature request. -->
<!-- Examples: Fixes #123 / Approved in #456 / No linked issue: localization-only update. -->

## Reproduction steps

<!-- Required for critical bug fixes. For localization-only PRs, write: No reproduction steps - localization-only update. -->

## Old behavior

<!-- What happened before this PR? For localization-only PRs, write: Not applicable - localization-only update. -->

## New behavior

<!-- What happens after this PR? -->

## Platform impact

<!-- Explain which platforms were affected and whether this change touches shared code. -->

- Desktop browser:
- Mobile / tablet browser:
- Installed PWA:
- Docker / self-hosting:

## UI / behavior / playback impact

<!-- Check every box that applies. At least one must be checked. -->

- [ ] No UI change
- [ ] No behavior change
- [ ] No playback change
- [ ] UI changed only to fix a documented glitch/bug
- [ ] Behavior changed only to fix a documented bug/regression
- [ ] Playback changed only to fix a documented bug/regression
- [ ] UI change has explicit maintainer approval
- [ ] Behavior change has explicit maintainer approval
- [ ] Playback change has explicit maintainer approval

## Policy check

<!-- ALL boxes must be checked or the PR may be closed without review. -->

- [ ] I have read and understood `CONTRIBUTING.md`.
- [ ] This PR fits the current PR policy or has explicit maintainer approval.
- [ ] This PR is small, focused, and limited to one issue.
- [ ] This PR does not bundle unrelated refactors, cleanups, formatting, or drive-by changes.
- [ ] This PR does not add dependencies, architecture changes, or broad refactors without approval.
- [ ] This PR does not change UI unless it fixes a linked glitch/bug or has explicit approval.
- [ ] This PR does not change behavior unless it fixes a linked bug/regression or has explicit approval.
- [ ] This PR does not change playback unless it fixes a linked bug/regression or has explicit approval.
- [ ] This PR does not change deployment or release behavior without clear need or approval.
- [ ] I included a linked issue, reproduction steps, and testing notes if this is a critical bug fix.
- [ ] I listed the testing performed below.

> Feature additions, broad UI changes, refactors, playback rewrites, and other non-critical changes may be closed or deferred without review.

## Scope boundaries

<!-- List anything intentionally not changed. If this is a bug fix, confirm it does not include extra UI polish, behavior tweaks, playback changes, or platform rewrites. -->

## Testing

<!-- What did you test and how? Include browsers, devices, commands, and manual flows. Do not write only "not tested" unless this is localization-only. -->

### Devices / platforms tested

<!-- Examples: Chrome on macOS, Safari on iPadOS, Firefox on Windows, installed PWA. -->

### Commands tested

<!-- Include relevant commands if applicable. -->

```sh
# Examples:
npm run build
npm test
```

## Manual test flow

<!-- Describe the exact flow tested in the app. -->

## Screenshots / Video

<!-- Required for any UI, layout, focus, or visual change. Write "Not a UI change" only if no UI changed. -->

## Logs

<!-- Required for crashes, blank screens, install/package failures, playback failures, or platform API errors. Write "Not applicable" if not relevant. -->

## Regression risk

<!-- Describe what could break across desktop/mobile browsers, installed PWA, or deployment. -->

## Breaking changes

<!-- Any breaking behavior/config/schema/package/app-id changes? If none, write: None. -->

## Linked issues

<!-- Required for critical bug fixes and approved changes. For localization-only PRs with no issue, write: No linked issue - localization-only update. -->
