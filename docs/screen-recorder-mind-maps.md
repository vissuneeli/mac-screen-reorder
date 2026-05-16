# macOS Screen Recorder: Mind Maps

## Product Mind Map

```mermaid
mindmap
  root((macOS Screen Recorder))
    Core Recording
      Full screen
      Display selection
      Window recording
      Region recording
      Countdown
      Timer
      Pause and resume
    Audio
      System audio
      Microphone
      Device picker
      Gain controls
      Audio meters
      Mute controls
      Noise suppression
    Visual Enhancements
      Camera overlay
      Cursor effects
      Click rings
      Keystroke overlay
      Recording border
      Floating timer
    Output
      WebM
      MP4 export
      Quality presets
      File naming templates
      Output folder profiles
      Compression presets
    Recording Library
      Recent recordings
      Search
      Rename
      Tags
      Thumbnails
      Favorites
      Reveal in Finder
      Move to Trash
    macOS Experience
      Menu bar control
      Global hotkeys
      Permission status
      Native dialogs
      Code signing
      Notarization
```

## Current Architecture Mind Map

```mermaid
mindmap
  root((Current Architecture))
    Main Process
      BrowserWindow
      App lifecycle
      Microphone access request
      Display discovery
      Desktop sources
      Output folder dialog
      Save recording
      Reveal file
      Delete file
    Preload Bridge
      contextBridge
      ipcRenderer.invoke
      electronAPI
      Narrow renderer access
    Renderer Process
      UI event handling
      Settings
      Recent history
      Display list rendering
      Capture orchestration
      Audio mixing
      MediaRecorder
      Status and timer
    Browser APIs
      getDisplayMedia
      getUserMedia
      Web Audio API
      MediaRecorder
      localStorage
    Storage
      Documents folder
      Selected output folder
      WebM files
      localStorage settings
      localStorage history
```

## Recording Flow Mind Map

```mermaid
mindmap
  root((Recording Flow))
    Initialize
      Load default output folder
      Load displays
      Restore settings
      Render recent recordings
    User Starts
      Validate selected display
      Read audio settings
      Create AudioMixer
      Show source picker status
    Capture Screen
      getDisplayMedia
        Video stream
        Optional system audio
      Fallback path
        getDesktopSources
        Match selected display
        getUserMedia desktop source
    Capture Audio
      System audio track
      Microphone stream
      Mic gain
      Audio meters
      Mixed output stream
    Record
      Combine video and mixed audio
      Show countdown
      Create MediaRecorder
      Start timer
      Store chunks
    Stop
      Stop MediaRecorder
      Stop timer
      Create Blob
      Convert to ArrayBuffer
      Save through IPC
      Add to history
      Cleanup streams
```

## Target Architecture Mind Map

```mermaid
mindmap
  root((Target Architecture))
    Renderer
      UI components
      Renderer store
      Capture controller
      Audio controller
      Preview
      Meters
      State machine
    Preload
      Typed API
      Valid request shapes
      No Node exposure
      IPC boundary
    Main Process
      WindowService
      PermissionService
      SourceService
      RecordingFileService
      LibraryService
      ExportService
      HotkeyService
      MenuBarService
    Storage
      App data settings
      Library metadata
      Temporary chunks
      Recording files
      Exported files
    Background Work
      MP4 conversion
      Thumbnail generation
      Compression
      Cleanup failed sessions
    Security
      Payload validation
      Safe output folders
      Recording IDs
      Move to Trash
      Permission checks
```

## State Machine Mind Map

```mermaid
mindmap
  root((Recorder States))
    Booting
      Create window
      Load renderer
      Initialize APIs
    Permission Check
      Screen Recording
      Microphone
      Camera later
      Open System Settings
    Idle
      Choose source
      Configure audio
      Configure quality
      Pick output folder
    Preparing Capture
      Acquire screen stream
      Acquire microphone
      Build mixed audio
      Validate codec support
    Countdown
      Show countdown
      Prepare recorder
    Recording
      Write chunks
      Update timer
      Update meters
      Listen for track ended
    Paused
      Pause MediaRecorder
      Preserve timer state
      Resume or stop
    Finalizing
      Stop recorder
      Flush chunks
      Save file
      Create metadata
    Post Recording
      Playback
      Trim
      Rename
      Reveal
      Export
    Error
      Show recoverable message
      Cleanup streams
      Recover temp files
```

## Security Mind Map

```mermaid
mindmap
  root((Security Boundary))
    Renderer Boundary
      Treat as untrusted
      No Node integration
      No direct filesystem
      Strict CSP
    Preload Boundary
      Small API surface
      Typed methods
      Known IPC channels
      No arbitrary invoke
    Main Boundary
      Validate payloads
      Own file policy
      Own app settings
      Own metadata
    File Safety
      Approved output folders
      Recording session IDs
      Path normalization
      No arbitrary delete
      Move to Trash
    Permissions
      Screen recording
      Microphone
      Camera only when used
      User-visible status
    Release Safety
      Real bundle ID
      App icon
      Code signing
      Notarization
      Remove unused entitlements
```

## Implementation Roadmap Mind Map

```mermaid
mindmap
  root((Roadmap))
    Phase 1 Reliability
      Deterministic source selection
      Codec support detection
      Better error states
      Track-ended handling
      Cleanup partial recordings
    Phase 2 Persistence
      Chunked save sessions
      Main-process metadata
      Safe delete
      Recording IDs
      Recover failed sessions
    Phase 3 Native Controls
      Pause resume
      Global hotkeys
      Menu bar controller
      Floating recording overlay
      Permission dashboard
    Phase 4 Export
      MP4 output
      Thumbnail generation
      Compression presets
      Export progress
      Background jobs
    Phase 5 Creation Tools
      Camera overlay
      Cursor effects
      Keystroke overlay
      Region recording
      Window recording
    Phase 6 Library
      Search
      Tags
      Rename
      Favorites
      Missing file repair
      Sort and filters
```

