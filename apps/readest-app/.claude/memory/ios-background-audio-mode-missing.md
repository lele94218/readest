---
name: ios-background-audio-mode-missing
description: "iOS read-aloud stopped at screen lock because the app never declared UIBackgroundModes=audio; it must live in the TRACKED src-tauri/Info-ios.plist, never in the gitignored generated plist"
metadata:
  node_type: memory
  type: project
---

iOS TTS stopped the moment the screen locked. **Not a TTS-code bug** — the app simply
never declared the audio background mode.

`NativeTTSPlugin.swift` already does the right thing on the session side:

```swift
try session.setCategory(.playback, mode: .spokenAudio, options: [])
try session.setActive(true)
```

But `.playback` only *permits* background audio. Without `UIBackgroundModes` containing
`audio`, iOS suspends the app at lock and playback dies. Verified by unpacking the shipped
0.12.13 IPA: `plutil -extract UIBackgroundModes` → *no value at that key path*.

`git log --all -S UIBackgroundModes -- apps/readest-app/src-tauri/` returns **nothing**, so
it has never been in the repo — including across upstream's history. Yet no upstream issue
reports it, because `apps/readest-app/.gitignore:62` ignores all of `src-tauri/gen`: enabling
"Background Modes → Audio" in Xcode edits the *generated, gitignored*
`gen/apple/Readest_iOS/Info.plist`, so the maintainer's own builds have it and nobody
upstream ever sees the gap. Anyone building from a clean checkout gets a binary without it.

**Fix: the key belongs in the tracked `src-tauri/Info-ios.plist`** (referenced by
`tauri.conf.json` → `bundle.iOS.infoPlist`), never in the generated one. Toggling the Xcode
capability is lost on the next regeneration.

Verified that Tauri re-merges on every `ios build`, not just on `ios init`: after adding the
key, the generated plist's mtime moved and `plutil -extract UIBackgroundModes json` returned
`["audio"]`. Both `src-tauri/Info.plist` (shared) and `src-tauri/Info-ios.plist` (iOS-only)
are merged into it — `NSFaceIDUsageDescription` comes from the former, so a key present in
the generated plist is not evidence it came from `Info-ios.plist`.

Related: [[ios-tts-media-session-native]] listed "background long-play" as a pending device
check that was never completed — this is why it would have failed.
