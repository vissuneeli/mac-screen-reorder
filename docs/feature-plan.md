# Screen Recorder Feature Plan

## Context

The review doc (`docs/screen-recorder-review.md`) identifies the app as a clean but basic recorder that needs reliability fixes and UX improvements to become a polished capture studio. The current implementation already has display selection, audio mixing, quality presets, recording history, and output folder selection. The goal is to evolve it into a reliable, fast-to-use tool for demos, tutorials, and bug reports — without over-engineering.

---

## What Already Exists (Do Not Re-implement)

- `get-desktop-sources` IPC handler in `src/main.ts` (already exists, just underused)
- `AudioMixer` + `AudioAnalyzer` classes in `src/renderer/app.ts`
- `RecordingHistory` class in `src/renderer/app.ts`
- `pick-output-folder` IPC handler
- `reveal-file` + `delete-file` IPC handlers (need hardening, not replacement)

---

## Recommended Features — Prioritized by Impact

### Phase 1: Reliability Fixes (Highest Priority)

**1A. Fix Display Source Enforcement**
- Problem: `getDisplayMedia()` shows macOS system picker, ignoring the user's selection
- Fix: Use the existing `get-desktop-sources` IPC to retrieve the `sourceId` for the selected display, then pass it to `getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } } })`
- Files: `src/renderer/app.ts` (capture logic), `src/main.ts` (already has handler)
- Display thumbnails from `desktopCapturer` can be shown in the display selector

**1B. Incremental Chunk Streaming to Disk**
- Problem: All `MediaRecorder` chunks accumulate in memory; long recordings risk OOM crashes
- Fix: Send chunks to main process every 5 seconds via IPC (`stream-chunk` handler); main process appends to a temp `.webm` file; on stop, finalize and rename
- Files: `src/main.ts` (new `stream-chunk` + `finalize-recording` handlers), `src/renderer/app.ts` (change `ondataavailable` to stream instead of accumulate)

**1C. Trash-Based Deletion + Confirmation**
- Problem: `delete-file` uses `fs.unlink` (permanent), no confirmation dialog
- Fix: Replace `fs.unlink` with `shell.trashItem()` in main process; add a simple "Are you sure?" confirm dialog in renderer before calling delete
- Files: `src/main.ts` (delete-file handler), `src/renderer/app.ts` (delete button handler)

---

### Phase 2: Recording Controls (High Value, Low Complexity)

**2A. Pause / Resume Recording**
- `MediaRecorder` natively supports `.pause()` and `.resume()` — minimal effort
- Add a Pause button (shown only during recording) that toggles between pause/resume states
- Update timer to stop counting while paused
- Show a "Paused" state visually (distinct from recording/idle)
- Files: `src/renderer/app.ts`, `src/renderer/index.html`, `src/renderer/styles.css`

**2B. Global Hotkeys**
- Add `globalShortcut` registration in main process:
  - `Cmd+Shift+R` → start/stop recording
  - `Cmd+Shift+P` → pause/resume
- Send IPC events to renderer to trigger recording state changes
- Files: `src/main.ts` (register shortcuts), `src/preload.ts` (expose listener), `src/renderer/app.ts` (handle events)

**2C. Menu Bar Tray Controller**
- Add `Tray` in main process with a minimal menu: elapsed time, Stop Recording, Pause, Quit
- Update tray label every second while recording (shows `REC 00:01:23`)
- Clicking the tray icon brings the window to front
- Files: `src/main.ts` (Tray setup + context menu)

---

### Phase 3: Audio Improvements

**3A. Microphone Device Picker**
- `navigator.mediaDevices.enumerateDevices()` already works in Electron renderer
- Add a `<select>` dropdown listing audioinput devices by label
- Pass chosen `deviceId` to `getUserMedia` constraint when capturing mic
- Files: `src/renderer/app.ts`, `src/renderer/index.html`

**3B. Noise Suppression + Echo Cancellation Toggles**
- These are already applied unconditionally (`noiseSuppression: true, echoCancellation: true`)
- Add two checkboxes to let users toggle them (some users prefer raw mic for music)
- Reflect the checkbox state in the `getUserMedia` constraints
- Files: `src/renderer/app.ts`, `src/renderer/index.html`

---

### Phase 4: Post-Recording Workflow

**4A. Inline Playback After Recording**
- After `save-recording` succeeds, show a `<video>` element using the blob URL (already in memory before streaming is implemented, or read back from disk afterward)
- Add play/pause controls + a close button to dismiss
- Files: `src/renderer/app.ts`, `src/renderer/index.html`, `src/renderer/styles.css`

**4B. MP4 Export Option**
- Use `fluent-ffmpeg` + a bundled `ffmpeg` binary (via `@ffmpeg-installer/ffmpeg` package)
- After recording completes, offer a "Convert to MP4" button that calls an IPC handler to transcode the `.webm` to `.mp4` (H.264/AAC)
- Show progress during conversion
- Files: `src/main.ts` (new `convert-to-mp4` IPC handler), `src/renderer/app.ts`, `package.json`

---

### Phase 5: Recording Library Improvements

**5A. Expanded Metadata + Sorting**
- Store duration, resolution, audio sources in the history JSON (already partially done)
- Add sort controls: by date (default), size, duration
- Show resolution and duration in the history list items
- Files: `src/renderer/app.ts` (RecordingHistory class)

**5B. Detect Missing Files**
- On app startup, check each history entry's file path exists
- Mark stale entries with a "File missing" badge and offer to remove them
- Files: `src/renderer/app.ts`

---

## Critical Files to Modify

| File | Changes |
|------|---------|
| `src/main.ts` | stream-chunk handler, finalize-recording, trash deletion, globalShortcut, Tray, convert-to-mp4 |
| `src/preload.ts` | expose new IPC methods (streamChunk, finalizeRecording, convertToMp4, onHotkeyEvent) |
| `src/renderer/app.ts` | fix capture with sourceId, chunk streaming, pause/resume, mic picker, noise toggles, playback, history improvements |
| `src/renderer/index.html` | Pause button, mic picker dropdown, noise toggles, playback section |
| `src/renderer/styles.css` | Paused state, playback styles |
| `package.json` | Add fluent-ffmpeg, @ffmpeg-installer/ffmpeg |

---

## Implementation Order

1. **Phase 1A** — Display source enforcement (fixes core reliability)
2. **Phase 1C** — Trash deletion + confirm dialog (quick win, user-facing safety)
3. **Phase 2A** — Pause/resume (zero new dependencies, pure MediaRecorder API)
4. **Phase 2B** — Global hotkeys (Electron built-in, high workflow value)
5. **Phase 1B** — Chunk streaming to disk (reliability for long recordings)
6. **Phase 3A** — Mic device picker (small UI addition, big usability gain)
7. **Phase 2C** — Menu bar tray (good polish, moderate effort)
8. **Phase 4A** — Inline playback (post-recording UX)
9. **Phase 3B** — Noise suppression toggles (small)
10. **Phase 4B** — MP4 export (requires ffmpeg dependency)
11. **Phase 5A+5B** — Library improvements

---

## Verification

- Build: `npm run build` must pass TypeScript compile
- Display fix: Selected display must be captured without the macOS system picker appearing
- Pause/resume: Timer stops/resumes; recording file is continuous
- Hotkeys: Work when app window is in background
- Trash: Deleted files appear in macOS Trash, not permanently removed
- Chunk streaming: A 10-minute recording must not crash or bloat memory
- MP4: Output plays in QuickTime with audio and video
