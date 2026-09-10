# Contributing

Thanks for helping improve NuvioWeb, the browser and installed-PWA media app.

## Before opening a pull request

Keep each pull request focused on one reproducible problem or an approved feature. Explain the old and new behavior, list the affected browser or device class, and include validation appropriate to the change.

Please do not bundle unrelated refactors, formatting, dependency changes, or UI redesigns with a bug fix. Playback, source selection, subtitles, audio tracks, watch progress, offline storage, authentication, and navigation are high-risk areas and need explicit testing notes.

For visual changes, include before-and-after screenshots or a short recording. For behavior changes, include clear reproduction steps and expected versus actual results.

## Supported targets

NuvioWeb supports desktop, mobile, and tablet browsers plus installed PWAs. Test on the browser and input method affected by your change where practical, including keyboard navigation, pointer input, or touch input.

## Bug reports

Include:

- App version or commit hash
- Browser, operating system, and device class
- Steps to reproduce
- Expected and actual behavior
- Screenshots, recording, console errors, or network errors when relevant

Use browser developer tools for browser/PWA diagnostics. Never include authentication tokens, signed media URLs, cookies, or other secrets in an issue.

## Feature requests

Describe the problem, proposed solution, alternatives considered, and compatibility risks for browser and PWA users. Large behavior, architecture, or product-direction changes require maintainer approval before implementation.
