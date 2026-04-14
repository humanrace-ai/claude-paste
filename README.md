# Claude Paste

**Paste images from your clipboard directly into Claude Code CLI conversations over SSH.**

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/humanrace-ai.claude-paste)](https://marketplace.visualstudio.com/items?itemName=humanrace-ai.claude-paste)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## The Problem

When using Claude Code over SSH in VS Code's integrated terminal, there's no way to paste screenshots. Claude Code supports image file paths, but getting a clipboard image onto a remote server means manual `scp` or upload steps every time.

## The Solution

**Claude Paste** captures clipboard images from your local machine, writes them to the remote host, and injects the file path into your terminal. Claude Code picks it up natively.

```
Clipboard (screenshot) --> VS Code Extension --> Remote file --> Terminal path --> Claude Code reads it
```

One paste. That's it.

## Features

- **Cmd+V / Ctrl+V** in the integrated terminal -- same shortcut you already use
- **SSH-native** -- works seamlessly in Remote-SSH sessions
- **Auto-cleanup** -- temp images expire after 1 hour (configurable)
- **Format support** -- PNG, JPEG, GIF, WebP
- **Zero interference** -- text paste works exactly as before

## Installation

### From VS Code Marketplace

Search for **"Claude Paste"** in the Extensions panel, or:

```bash
code --install-extension humanrace-ai.claude-paste
```

### From VSIX

```bash
code --install-extension claude-paste-image-0.2.0.vsix
```

## Usage

1. Copy a screenshot or image to your clipboard
2. Focus the VS Code integrated terminal (where Claude Code is running)
3. Press **Cmd+V** (Mac) or **Ctrl+V** (Windows/Linux)
4. A paste target appears briefly -- press **Cmd+V** again to capture the image
5. The image file path is injected into your terminal automatically

Claude Code reads the image and responds with full visual context.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `claudePaste.imageTTL` | `3600` | Seconds before temp images are cleaned up |
| `claudePaste.imageDir` | `/tmp/claude-paste/images` | Directory for temp image storage |
| `claudePaste.maxImageSize` | `10485760` | Max image size in bytes (10MB) |
| `claudePaste.enableStatusBar` | `true` | Show clipboard status in status bar |

## How It Works

The extension uses a **webview clipboard bridge** -- a pattern that solves a core limitation of VS Code's extension API (which can only read text from the clipboard, not images).

When you paste in the terminal:
1. If the clipboard has text, it pastes normally with zero delay
2. If the clipboard is empty (typical when you've copied an image), the extension opens a lightweight webview
3. The webview runs in your **local** VS Code renderer, giving it access to your Mac's clipboard even over SSH
4. It captures the image data, sends it to the extension host on the remote server, and writes it as a temp file
5. The file path is injected into the terminal and the webview closes

This approach works because VS Code's webviews always run locally, regardless of whether you're connected via Remote-SSH. The image data is transferred through VS Code's built-in webview message passing.

## Requirements

- VS Code 1.85+
- macOS, Windows, or Linux client
- Works with any remote host (SSH, WSL, Containers)

## Development

```bash
git clone https://github.com/humanrace-ai/claude-paste.git
cd claude-paste
npm install
npm run test        # Run test suite
npm run compile     # Build
npm run package     # Create .vsix
```

## License

MIT -- see [LICENSE](LICENSE) for details.

---

<p align="center">
  <br>
  Built by <a href="https://humanrace.ai"><strong>Human Race AI</strong></a>
  <br>
  <em>AI infrastructure for teams that ship</em>
  <br>
  <br>
  <a href="https://humanrace.ai">humanrace.ai</a>
</p>
