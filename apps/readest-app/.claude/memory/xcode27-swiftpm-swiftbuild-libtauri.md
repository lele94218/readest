---
name: xcode27-swiftpm-swiftbuild-libtauri
description: "Xcode 27 / Swift 6.4 made SwiftPM default to the swiftbuild engine; iOS builds then fail with 'could not find native static library Tauri' — vendored swift-rs now pins --build-system native"
metadata:
  node_type: memory
  type: project
---

iOS builds broke after upgrading to **Xcode 27.0 (Swift 6.4)** with:

```
error: could not find native static library `Tauri`, perhaps an -L flag is missing?
error: could not compile `tauri` (lib)
```

**Root cause: SwiftPM flipped its default build system** from `native` (llbuild) to
`swiftbuild`:

```
$ swift build --help
  --build-system <build-system>   (default: swiftbuild)
        native      - Native Build System (deprecated)
        swiftbuild  - Swift Build build engine (default)
```

The vendored `packages/swift-rs` hardcodes the *native* output layout — it emits
`cargo:rustc-link-search=native=<build-path>/<unversioned-triple>/<config>`. Under
`swiftbuild` nothing lands there, so the `-L` points at a directory that does not exist.

This is nasty to diagnose because **`swift build` still exits 0**, and swift-rs only panics
on a non-zero exit — so the failure surfaces much later, at the rustc link step, as a
misleading "missing -L flag". Signature of the bad state: the build path contains
`manifest.pif` and `.buildSystem_release` (contents: `swiftbuild`) and **no `.a` anywhere**.

**Fix (stopgap):** `swift_supports_build_system_flag()` probes `swift build --help`, and
when present the invocation passes `--build-system native`, restoring the old layout.
Hand-verified: that invocation reports `[6/7] Archiving libTauri.a` and drops a 744KB
archive at `<build-path>/arm64-apple-ios/release/libTauri.a`.

**`native` is deprecated and will be removed** — Swift already warns on every build. The
durable fix is teaching the search path `swiftbuild`'s layout. Do that before a toolchain
drops `native`.

This is the second Xcode-version break this vendored copy absorbs; the first (Xcode 26.2 /
Swift 6.2, per-swiftc `-target` override no longer honored → `--triple`/`--sdk`) is
documented in the `[patch.crates-io]` comment in the root `Cargo.toml`. Expect a third.

Unrelated but concurrent environment breakage, for anyone bisecting the same window: the
project moved onto an external volume, so pnpm's store moved with it and `pnpm install`
demanded a `node_modules` purge (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`). Neither has
anything to do with [[ios-background-audio-mode-missing]], the bug actually being fixed.
