# Architecture

## Component Diagram

```
+----------------------------------+
|        VSCode Extension          |
|  (extension.ts - entry point)    |
+----------------------------------+
|                                  |
|  +-----------+  +--------------+ |
|  | Webview   |  | StatusBar    | |
|  | Clipboard |  | Item         | |
|  | Bridge    |  |              | |
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

### WebviewClipboardBridge
- Opens a webview panel to read clipboard image data
- Tries `navigator.clipboard.read()` first (auto-read, no gesture needed)
- Falls back to a paste-target UI if permissions block auto-read
- Webview always runs **locally** (renderer side), even over Remote-SSH
- Image data is sent to extension host via VSCode message passing

### ImageWriterService
- Receives raw image buffer
- Generates UUID filename with correct extension
- Writes to configured temp directory (`/tmp/claude-paste/images/`)
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

### ClipboardService (legacy)
- Detects base64/data URI image content in clipboard text
- Used by unit tests and smoke tests
- Not used in production flow (WebviewClipboardBridge handles real clipboard)

## Data Flow

1. User copies screenshot on Mac (Cmd+Shift+4, etc.)
2. User focuses VSCode terminal with Claude Code running
3. User presses Cmd+V (Mac) or Ctrl+V
4. Extension checks clipboard text -- if text found, normal paste
5. If clipboard text is empty (image copied), webview opens
6. Webview reads clipboard image via browser API (runs locally)
7. Image data sent to extension host (remote) via message passing
8. ImageWriter saves to `/tmp/claude-paste/images/<uuid>.png`
9. TerminalInjector sends file path to terminal
10. Claude Code CLI reads the image natively
11. CleanupService removes temp file after TTL

## SSH Architecture

- Extension host runs on the **remote server** (installed via Remote-SSH)
- Webview runs in the **local renderer** (your Mac) -- this is how clipboard access works
- Image data transfers through VSCode's built-in webview message bridge
- Files are written to the **remote** filesystem where Claude Code runs
- Paths injected are **remote** absolute paths

## Configuration

All settings live under `claudePaste.*` namespace in VSCode settings.
See package.json `contributes.configuration` for schema.
