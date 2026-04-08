# Claude Paste - VSCode Extension

Paste images from your Mac clipboard directly into Claude Code CLI conversations over SSH.

## Problem

When using Claude Code CLI over SSH in VSCode's integrated terminal, `Ctrl+V` / `Cmd+V` only pastes text. There's no way to paste screenshots or clipboard images into the conversation -- Claude Code supports image file paths, but getting a screenshot from your Mac clipboard onto the remote server requires manual `scp` or file upload steps.

## Solution

**Claude Paste** intercepts image paste events in VSCode, saves the clipboard image to a temp file on the remote host, and injects the file path into the active terminal -- letting Claude Code's native image support pick it up seamlessly.

## How It Works

```
Mac Clipboard (screenshot)
    |
    v
VSCode Extension (intercepts Cmd+V in terminal)
    |
    v
Decode image data from clipboard API
    |
    v
Write to temp file on remote host (~/.claude-paste/images/<timestamp>.png)
    |
    v
Inject file path into active terminal input
    |
    v
Claude Code CLI reads the image natively
```

## Features

- **Cmd+V / Ctrl+V image paste** in VSCode integrated terminal
- **SSH-aware** -- works in Remote-SSH sessions, writes to remote filesystem
- **Auto-cleanup** -- configurable TTL for temp images (default: 1 hour)
- **Format support** -- PNG, JPEG, GIF, WebP from clipboard
- **Non-destructive** -- text paste behavior unchanged when clipboard has no image
- **Status bar indicator** -- shows when an image is on clipboard and ready to paste

## Architecture (SPARC)

### S - Specification
- VSCode extension activated on terminal focus
- Intercepts paste keybinding when clipboard contains image data
- Writes image to `~/.claude-paste/images/` with UUID filename
- Injects absolute path into terminal stdin
- Cleanup daemon removes files older than TTL

### P - Pseudocode
See `docs/pseudocode.md`

### A - Architecture
See `docs/architecture.md`

### R - Refinement
- TDD with vitest
- Integration tests against mock terminal API
- E2E test with actual clipboard data

### C - Completion
- Extension published to VS Code Marketplace
- Works with both local and Remote-SSH terminals

## Requirements

- VSCode 1.85+
- Claude Code CLI installed on target host
- macOS client (clipboard source)
- Node.js 18+ (for extension development)

## Installation

```bash
# From marketplace (when published)
code --install-extension humanrace-ai.claude-paste

# From source
cd claude-paste-extension
npm install
npm run compile
# Press F5 in VSCode to launch Extension Development Host
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `claudePaste.imageTTL` | `3600` | Seconds before temp images are cleaned up |
| `claudePaste.imageDir` | `~/.claude-paste/images` | Directory for temp image storage |
| `claudePaste.maxImageSize` | `10485760` | Max image size in bytes (10MB) |
| `claudePaste.enableStatusBar` | `true` | Show clipboard status in status bar |

## Development

```bash
npm install
npm run test        # Run TDD test suite
npm run compile     # Build extension
npm run lint        # ESLint
npm run package     # Create .vsix
```

## License

MIT
