---
name: assistant-ui-0-11-57-unbound-init-crash
description: "@assistant-ui/react must stay pinned to 0.11.56 — 0.11.57/0.11.58 crash the AI chat panel with 'undefined is not an object (this._getInitializePromise=e)'"
metadata:
  node_type: memory
  type: project
---

**Keep `@assistant-ui/react` pinned to `0.11.56`.** Upstream readest ships `0.11.58`, so every
merge from `upstream/main` will try to drag the bump back in. Take ours, not theirs.

`0.11.57` introduced an unbound method call in
`dist/legacy-runtime/runtime-cores/remote-thread-list/RemoteThreadListHookInstanceManager.js`:

```js
const setGetInitializePromise = runtimeCore["__internal_setGetInitializePromise"];
if (typeof setGetInitializePromise === "function") {
  setGetInitializePromise(() => initPromiseRef.current);   // called detached from runtimeCore
}
```

The method body is `this._getInitializePromise = getPromise` in `LocalThreadRuntimeCore`. Because
the dist is strict-mode ESM, the detached call leaves `this === undefined` and the whole reader
route dies at mount with:

```
undefined is not an object (evaluating 'this._getInitializePromise=e')
__internal_setGetInitializePromise@tauri://localhost/_next/static/chunks/...
```

On iOS this takes out the entire app with the "Oops!" error screen, not just the chat panel.
`0.11.56` and earlier do not contain the symbol at all. `0.11.58` is the **last** `0.11.x`
release, so there is no patch release to move up to — the next line is `0.12.x`, which is a
breaking API change. Downgrading is the only in-line fix.

Cost of the pin: `@assistant-ui/react-ai-sdk@1.2.0` declares a peer of `^0.11.58`, so pnpm emits
an unmet-peer warning. It is cosmetic — this exact pair (`0.11.56` + `react-ai-sdk@1.2.0`) is
what the fork shipped from 0.12.0 through 0.12.10.

Regression history: the bump slipped in with the 463-commit upstream sync shipped as 0.12.12,
which crashed on launch on device. Fixed in 0.12.13.
