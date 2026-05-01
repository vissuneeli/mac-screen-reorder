# macOS Screen Recorder

A desktop screen recorder built with Electron + TypeScript for macOS.

It supports:
- Multi-display selection
- Optional microphone capture
- Optional system audio (with fallback behavior)
- Simple recording controls with timer and save-to-Documents flow

## Features

- Select from available displays before starting
- Record screen video as `.webm`
- Capture microphone audio with gain control
- Attempt system audio capture when supported
- Automatic fallback when certain system audio capture modes are not supported
- Saves recordings to your `Documents` folder

## Tech Stack

- Electron
- TypeScript
- Plain HTML/CSS renderer UI
- IPC bridge via `preload.ts` (`contextIsolation: true`, `nodeIntegration: false`)

## Project Structure

- `src/main.ts` - Electron main process, window creation, IPC handlers
- `src/preload.ts` - safe renderer API bridge
- `src/renderer/app.ts` - recorder logic + UI event handling
- `src/renderer/index.html` - app UI
- `src/renderer/styles.css` - styling
- `entitlements.mac.plist` - macOS entitlements for packaging

## Prerequisites

- macOS
- Node.js 18+ (recommended current LTS)
- npm

## Install

```bash
npm install
```

## Run (Development)

```bash
npm run dev
```

This compiles TypeScript, copies renderer assets into `dist/`, and launches Electron.

## Build

```bash
npm run build
```

## Package App

```bash
npm run make
```

Uses `electron-builder` and mac config in `package.json`.

## macOS Permissions

For recording to work, macOS may prompt for:
- Screen Recording
- Microphone

If denied, enable permissions in:
- System Settings -> Privacy & Security -> Screen Recording
- System Settings -> Privacy & Security -> Microphone

## Recording Behavior Notes

- Display list is gathered from Electron's display APIs.
- On some setups, `getDisplayMedia` with audio can throw `NotSupportedError`.
- The app includes a fallback path to desktop-source capture to continue recording the selected screen.
- Output format is `.webm` using `MediaRecorder`.

## Security / Repo Hygiene

- `.gitignore` excludes build artifacts, dependencies, and editor local data.
- A local pre-commit secret scanner is installed at `.git/hooks/pre-commit`.
- Manual secret scan command:

```bash
npm run scan:secrets
```

The scanner checks staged files for common token/key/password patterns.

## Available npm Scripts

- `npm run dev` - build + run Electron app
- `npm run build` - TypeScript compile + copy assets
- `npm run make` - package with electron-builder
- `npm run scan:secrets` - run local secret scan script

## Output Location

Recordings are saved to:
- `~/Documents/recording-<timestamp>.webm`

## Troubleshooting

- **App opens but can't record**  
  Verify Screen Recording and Microphone permissions in macOS settings.

- **Start recording fails immediately**  
  Try toggling system audio off and retry. Some environments have limited support for combined display+audio capture paths.

- **No displays shown**  
  Restart the app and verify macOS display setup is active. External monitor hot-plug can require app restart.

## License

No license file is currently included. Add one (for example MIT) if you plan public/open-source distribution.
