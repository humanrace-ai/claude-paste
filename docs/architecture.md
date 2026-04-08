# Architecture

## Component Diagram

```
+----------------------------------+
|        VSCode Extension          |
|  (extension.ts - entry point)    |
+----------------------------------+
|                                  |
|  +-----------+  +--------------+ |
|  | Clipboard |  | StatusBar    | |
|  | Service   |  | Controller   | |
|  +-----------+  +--------------+ |
|       |                          |
|  +-----------+  +--------------+ |
|  | Image     |  | Cleanup      | |
|  | Writer    |  | Service      | |
|  +-----------+  +--------------+ |
|       |                          |
|  +-----------+                   |
|  | Terminal  |                   |
|  | Injector  |                   |
|  +-----------+                   |
+----------------------------------+
         |
    [VSCode API]
         |
    [Terminal stdin]
         |
    [Claude Code CLI]
```

## Services

### ClipboardService
- Reads clipboard via VSCode `env.clipboard` API
- Detects whether clipboard contains image data (base64-encoded)
- Falls back to `pbpaste` / `xclip` for binary image data
- Returns `ClipboardContent` with type discriminator

### ImageWriterService
- Receives raw image buffer
- Generates UUID filename with correct extension
- Writes to configured temp directory (`~/.claude-paste/images/`)
- Resolves `~` to actual home directory
- Returns absolute file path

### TerminalInjectorService
- Gets reference to active VSCode terminal
- Sends file path as text via `terminal.sendText()`
- Does NOT send newline -- user controls when to submit
- Validates terminal exists and is active

### CleanupService
- Runs on configurable interval (default: every 10 minutes)
- Scans image directory for files older than TTL
- Deletes expired files
- Logs cleanup activity

### StatusBarController
- Shows clipboard image status in VSCode status bar
- Updates on focus change and clipboard activity
- Click triggers manual paste command

## Data Flow

1. User copies screenshot on Mac (Cmd+Shift+4, etc.)
2. User focuses VSCode terminal with Claude Code running
3. User presses Cmd+Shift+V (keybinding)
4. Extension intercepts -- ClipboardService checks for image
5. If image found: ImageWriter saves to temp file
6. TerminalInjector sends file path to terminal
7. Claude Code CLI picks up the image path on next message
8. CleanupService eventually removes the temp file

## SSH Considerations

- In Remote-SSH sessions, the extension runs on the **remote host**
- Clipboard data travels through VSCode's clipboard API bridge
- Image files are written to the **remote** filesystem
- Paths injected are **remote** absolute paths
- This is the correct behavior -- Claude Code runs on the remote host

## Configuration

All settings live under `claudePaste.*` namespace in VSCode settings.
See package.json `contributes.configuration` for schema.
