# Building the LocalDrop executable

Produces a single Windows `.exe` that starts the server, serves the web UI, and
opens the browser — no Node.js install required on the target machine.

## Build

```bash
pnpm --filter @localdrop/server build:exe
```

Output: `apps/server/release/LocalDrop.exe` (~61 MB).

Other platforms (the base Node binary is downloaded automatically on first run):

```bash
# from apps/server
node scripts/build-exe.mjs node22-macos-x64
node scripts/build-exe.mjs node22-linux-x64
```

## What the build does

1. Builds the web UI with **Vite's Node API** (`apps/web/dist`).
   - The Vite *CLI* is intercepted by the Console Ninja editor extension in some
     shells and silently no-ops, so we call the Node API directly.
2. Embeds every file in `dist` (base64) into `src/generated/webAssets.ts`.
3. Bundles the ESM server + web assets + all deps into one CJS file with esbuild.
4. Wraps Node + the bundle into one `.exe` with `@yao-pkg/pkg`.
5. Restores the empty `webAssets.ts` stub so the base64 never lands in git.

## How it runs

- Picks the first free port starting at **3001**.
- Serves the UI and the API/WebSocket from the **same origin** (the web app
  already talks to `/` and `/api`, so one port covers everything).
- Shares files from **`~/LocalDrop`** (created on first run). Override with the
  `SHARED_DIR` environment variable; override the port with `PORT`.
- Device discovery uses UDP **41234** (falls back to QR / manual IP if taken).

## Distributing

Ship just `LocalDrop.exe`. Double-click to run. Windows SmartScreen may warn on
first launch because the binary is unsigned (More info → Run anyway), or sign it
with your code-signing certificate.

> Note: the repo's `pnpm --filter @localdrop/web build` currently fails at its
> `tsc -b` type-check step (pre-existing). `build:exe` does not depend on it —
> it runs Vite directly.
