# macOS Screen Recorder: System Design and Flow Architecture

## Purpose

This document describes the current architecture of the Electron-based macOS Screen Recorder and proposes a stronger target architecture for future features such as pause/resume, MP4 export, webcam overlay, global hotkeys, menu bar mode, and a richer recordings library.

## Current System Overview

The app is a single-window Electron desktop application. The main process owns native Electron capabilities such as windows, display discovery, desktop sources, filesystem writes, dialogs, and Finder actions. The renderer owns the UI, browser media capture, microphone capture, audio mixing, recording state, settings, and recent recording history.

```mermaid
flowchart LR
  User["User"] --> RendererUI["Renderer UI<br/>index.html + styles.css"]
  RendererUI --> RecorderApp["RecorderApp<br/>src/renderer/app.ts"]
  RecorderApp --> BrowserMedia["Browser Media APIs<br/>getDisplayMedia<br/>getUserMedia<br/>MediaRecorder"]
  RecorderApp --> AudioMixer["AudioMixer<br/>Web Audio API"]
  RecorderApp --> LocalStorage["localStorage<br/>settings + recent history"]
  RecorderApp --> Preload["Preload Bridge<br/>src/preload.ts"]
  Preload --> IPC["Electron IPC<br/>ipcRenderer.invoke"]
  IPC --> Main["Main Process<br/>src/main.ts"]
  Main --> ElectronNative["Electron Native APIs<br/>screen<br/>desktopCapturer<br/>dialog<br/>shell"]
  Main --> FileSystem["File System<br/>Documents/output folder"]
```

## Current Runtime Components

| Component | File | Responsibility |
| --- | --- | --- |
| Main process | `src/main.ts` | Creates the app window, asks for microphone access, exposes IPC handlers, reads display/source data, saves/deletes files. |
| Preload bridge | `src/preload.ts` | Exposes a controlled `window.electronAPI` to the renderer. |
| Renderer app | `src/renderer/app.ts` | Handles UI events, capture flow, recording, audio mixing, settings, recent history, and status updates. |
| Renderer view | `src/renderer/index.html` | Defines the visible controls and sections. |
| Renderer styles | `src/renderer/styles.css` | Styles the app UI. |
| Build config | `package.json`, `tsconfig.json` | Builds TypeScript, copies renderer assets, and packages with Electron Builder. |

## Current IPC Surface

```mermaid
flowchart TB
  Renderer["Renderer"] -->|getDisplays()| MainGetDisplays["get-displays"]
  Renderer -->|getDesktopSources()| MainSources["get-desktop-sources"]
  Renderer -->|openScreenPrivacySettings()| MainPrivacy["open-screen-privacy-settings"]
  Renderer -->|saveRecording(buffer, filename, folder)| MainSave["save-recording"]
  Renderer -->|pickOutputFolder()| MainPick["pick-output-folder"]
  Renderer -->|getDefaultOutput()| MainDefault["get-default-output"]
  Renderer -->|revealFile(path)| MainReveal["reveal-file"]
  Renderer -->|deleteFile(path)| MainDelete["delete-file"]

  MainGetDisplays --> Screen["electron.screen"]
  MainSources --> DesktopCapturer["electron.desktopCapturer"]
  MainPrivacy --> SystemSettings["macOS System Settings"]
  MainSave --> FSWrite["fs.writeFileSync"]
  MainPick --> Dialog["dialog.showOpenDialog"]
  MainDefault --> AppPaths["app.getPath('documents')"]
  MainReveal --> Finder["shell.showItemInFolder"]
  MainDelete --> FSDelete["fs.unlinkSync"]
```

## Current Recording Flow

```mermaid
sequenceDiagram
  participant U as User
  participant UI as Renderer UI
  participant R as RecorderApp
  participant M as Browser Media APIs
  participant A as AudioMixer
  participant MR as MediaRecorder
  participant IPC as Preload/IPc
  participant Main as Main Process
  participant FS as File System

  U->>UI: Click Start Recording
  UI->>R: startRecording()
  R->>M: getDisplayMedia(video + optional system audio)
  alt getDisplayMedia with audio unsupported
    R->>IPC: getDesktopSources()
    IPC->>Main: get-desktop-sources
    Main-->>IPC: screen sources
    IPC-->>R: desktop sources
    R->>M: getUserMedia(desktop source video only)
  end
  opt Microphone enabled
    R->>M: getUserMedia(microphone)
  end
  R->>A: add system audio source if available
  R->>A: add microphone source if available
  A-->>R: mixed audio stream
  R->>R: show 3 second countdown
  R->>MR: create MediaRecorder(combined stream)
  R->>MR: start(timeslice = 1000ms)
  MR-->>R: dataavailable chunks
  R->>R: store chunks in memory
  U->>UI: Click Stop Recording
  UI->>R: stopRecording()
  R->>MR: stop()
  MR-->>R: onstop
  R->>R: create Blob and ArrayBuffer
  R->>IPC: saveRecording(buffer, filename, folder)
  IPC->>Main: save-recording
  Main->>FS: write file
  FS-->>Main: saved path
  Main-->>IPC: success + path
  IPC-->>R: save result
  R->>R: add recent recording to localStorage
  R->>UI: show saved status
```

## Current State Model

The current implementation uses a small set of booleans and nullable fields instead of an explicit state machine.

```mermaid
stateDiagram-v2
  [*] --> Initializing
  Initializing --> Ready: displays loaded + settings restored
  Ready --> SelectingSource: user clicks Start
  SelectingSource --> Countdown: capture streams acquired
  SelectingSource --> Failed: permission denied or source error
  Countdown --> Recording: MediaRecorder started
  Recording --> Saving: user stops or video track ends
  Saving --> Saved: file written
  Saving --> Failed: save error
  Failed --> Ready: cleanup
  Saved --> Ready: cleanup
```

Recommended future state machine:

```mermaid
stateDiagram-v2
  [*] --> Booting
  Booting --> PermissionCheck
  PermissionCheck --> Idle
  Idle --> SourceSelection
  SourceSelection --> PreparingCapture
  PreparingCapture --> Countdown
  Countdown --> Recording
  Recording --> Paused
  Paused --> Recording
  Recording --> Finalizing
  Paused --> Finalizing
  Finalizing --> PostRecording
  PostRecording --> Idle
  PreparingCapture --> Error
  Recording --> Error
  Finalizing --> Error
  Error --> Idle
```

## Current Data Flow

```mermaid
flowchart TD
  SettingsUI["Settings controls"] --> LocalSettings["localStorage: screenRecorderSettings"]
  LocalSettings --> AppInit["App init restores settings"]

  DisplayIPC["get-displays IPC"] --> DisplayList["Renderer display list"]
  DisplayList --> SelectedDisplay["selectedDisplayId"]
  SelectedDisplay --> FallbackCapture["desktop source fallback"]

  ScreenStream["Screen MediaStream"] --> CombinedStream["Combined MediaStream"]
  SystemAudio["System audio tracks"] --> AudioMixer["AudioMixer"]
  MicStream["Microphone MediaStream"] --> AudioMixer
  AudioMixer --> MixedAudio["Mixed audio stream"]
  MixedAudio --> CombinedStream
  CombinedStream --> MediaRecorder["MediaRecorder"]
  MediaRecorder --> Chunks["recordedChunks[]"]
  Chunks --> Blob["Blob"]
  Blob --> Buffer["ArrayBuffer"]
  Buffer --> SaveIPC["save-recording IPC"]
  SaveIPC --> File["WebM file on disk"]
  File --> RecentHistory["localStorage: recordingHistory"]
```

## Recommended Target Architecture

The app will scale better if capture logic, persistence, and native operations move behind explicit services. The renderer should become mostly UI orchestration and live media preview, while the main process owns trusted persistence, file operations, hotkeys, menu bar control, and export jobs.

```mermaid
flowchart LR
  subgraph Renderer["Renderer Process"]
    UI["UI Components"]
    Store["Renderer Store<br/>recording state"]
    CaptureController["Capture Controller"]
    AudioController["Audio Controller"]
    Preview["Preview + Meters"]
  end

  subgraph Bridge["Preload Bridge"]
    API["Typed electronAPI"]
  end

  subgraph Main["Main Process"]
    WindowService["Window Service"]
    PermissionService["Permission Service"]
    SourceService["Source Service"]
    RecordingService["Recording File Service"]
    LibraryService["Recording Library Service"]
    ExportService["Export Service"]
    HotkeyService["Global Hotkey Service"]
    MenuBarService["Menu Bar Service"]
  end

  subgraph Storage["Storage"]
    AppData["App Data JSON/SQLite<br/>settings + library"]
    OutputFiles["Output Folder<br/>recordings + exports"]
    TempFiles["Temporary Chunk Files"]
  end

  UI --> Store
  Store --> CaptureController
  CaptureController --> AudioController
  CaptureController --> Preview
  CaptureController --> API
  API --> SourceService
  API --> RecordingService
  API --> LibraryService
  API --> PermissionService
  HotkeyService --> WindowService
  MenuBarService --> WindowService
  RecordingService --> TempFiles
  RecordingService --> OutputFiles
  LibraryService --> AppData
  ExportService --> OutputFiles
```

## Future Module Breakdown

| Module | Process | Responsibility |
| --- | --- | --- |
| `PermissionService` | Main | Check/open macOS Screen Recording, Microphone, and Camera permissions. |
| `SourceService` | Main | Return displays, windows, thumbnails, and source metadata. |
| `CaptureController` | Renderer | Acquire screen/window/region streams and coordinate recording lifecycle. |
| `AudioController` | Renderer | Manage microphone selection, system audio, gain, mute, meters, and mixing. |
| `RecorderStateMachine` | Renderer | Enforce valid transitions across idle, recording, paused, saving, and error states. |
| `RecordingFileService` | Main | Create recording sessions, append chunks, finalize files, clean temporary files. |
| `LibraryService` | Main | Store recording metadata, search, rename, delete/move-to-trash, and repair missing records. |
| `ExportService` | Main or worker | Convert WebM to MP4, compress, generate thumbnails, and run background export jobs. |
| `HotkeyService` | Main | Register global start/stop/pause shortcuts. |
| `MenuBarService` | Main | Provide menu bar status, timer, and quick actions. |

## Recommended Future Save Flow

The current app saves only after recording stops. A safer design is session-based chunk persistence.

```mermaid
sequenceDiagram
  participant R as Renderer
  participant IPC as Preload/IPc
  participant S as RecordingFileService
  participant T as Temp File
  participant L as LibraryService
  participant O as Output Folder

  R->>IPC: createRecordingSession(metadata)
  IPC->>S: create session
  S->>T: create temp file
  S-->>R: sessionId
  loop Every MediaRecorder chunk
    R->>IPC: appendRecordingChunk(sessionId, chunk)
    IPC->>S: append chunk
    S->>T: write chunk
  end
  R->>IPC: finalizeRecording(sessionId)
  IPC->>S: finalize
  S->>O: move/rename temp file
  S->>L: create library record
  L-->>S: recording metadata
  S-->>R: saved recording metadata
```

Benefits:

- Long recordings do not live entirely in renderer memory.
- A crashed renderer can leave recoverable temporary chunks.
- Main process can validate paths and enforce safe output directories.
- Library metadata can be created in one trusted place.

## Recommended Permission Flow

```mermaid
flowchart TD
  Start["App launch"] --> CheckMic["Check microphone permission"]
  Start --> CheckScreen["Check screen recording permission"]
  CheckMic --> MicGranted{"Mic granted?"}
  CheckScreen --> ScreenGranted{"Screen granted?"}
  MicGranted -->|Yes| ReadyMic["Mic controls enabled"]
  MicGranted -->|No| MicPrompt["Show mic permission action"]
  ScreenGranted -->|Yes| ReadyScreen["Capture controls enabled"]
  ScreenGranted -->|No| ScreenPrompt["Show screen permission action"]
  MicPrompt --> OpenMicSettings["Open System Settings"]
  ScreenPrompt --> OpenScreenSettings["Open System Settings"]
  ReadyMic --> Ready["Ready when required permissions exist"]
  ReadyScreen --> Ready
```

## Recommended Feature Flow: Pause and Resume

```mermaid
sequenceDiagram
  participant U as User
  participant R as RecorderStateMachine
  participant MR as MediaRecorder
  participant UI as UI

  U->>UI: Click Pause
  UI->>R: pause()
  R->>MR: pause()
  R->>UI: state = Paused
  U->>UI: Click Resume
  UI->>R: resume()
  R->>MR: resume()
  R->>UI: state = Recording
```

## Recommended Feature Flow: MP4 Export

```mermaid
flowchart LR
  WebM["Saved WebM recording"] --> ExportRequest["User chooses Export MP4"]
  ExportRequest --> ExportJob["ExportService job"]
  ExportJob --> Transcoder["FFmpeg or native encoder"]
  Transcoder --> MP4["MP4 output"]
  MP4 --> LibraryUpdate["Update library metadata"]
  LibraryUpdate --> UI["Show exported file actions"]
```

## Security Boundaries

```mermaid
flowchart TB
  Renderer["Renderer<br/>untrusted UI boundary"] -->|typed IPC only| Preload["Preload<br/>narrow API"]
  Preload --> Main["Main Process<br/>trusted native boundary"]
  Main --> Validator["Payload validation"]
  Validator --> Policy["Path and permission policy"]
  Policy --> Native["Native APIs and filesystem"]
```

Recommended rules:

- Renderer never sends arbitrary file paths for deletion without a known recording ID.
- Main process validates every IPC payload.
- Main process owns output folder permissions and recording metadata.
- Delete should move files to Trash when possible.
- Export jobs should write only to approved folders.

## Deployment Architecture

```mermaid
flowchart TD
  Source["TypeScript source"] --> TSC["tsc"]
  TSC --> Dist["dist/"]
  Assets["HTML/CSS assets"] --> CopyAssets["copy-assets"]
  CopyAssets --> Dist
  Dist --> ElectronBuilder["electron-builder"]
  ElectronBuilder --> DMG["macOS DMG"]
  ElectronBuilder --> ZIP["macOS ZIP"]
  DMG --> Signing["Code signing"]
  ZIP --> Signing
  Signing --> Notarization["Apple notarization"]
  Notarization --> Release["Release artifact"]
```

## Implementation Roadmap

1. Create explicit recorder states and replace scattered boolean state with a state machine.
2. Replace full-buffer saving with chunked recording sessions.
3. Move recording history from `localStorage` to main-process app data storage.
4. Harden IPC request validation and file path policies.
5. Add source thumbnails and make source selection deterministic.
6. Add pause/resume.
7. Add global hotkeys and menu bar controls.
8. Add MP4 export and thumbnail generation.
9. Add webcam overlay and cursor effects.
10. Add a searchable recording library.

## Summary

The current architecture is appropriate for a prototype or minimal local recorder. For a polished macOS app, the main process should own trusted system operations, persistent metadata, file safety, hotkeys, menu bar controls, and export jobs. The renderer should focus on UI, media stream acquisition, live controls, previews, and a clear recording state machine.

