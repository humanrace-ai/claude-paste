# Changelog

## 0.2.0 — 2026-04-14

### Fixed
- **Focus now returns to the terminal after every paste path.** Previously, the webview bridge stole focus and left the user clicking back into the terminal. The source terminal is now captured before the webview opens and refocused on success, error, cancel, and oversized-image paths.
- **Text paste no longer breaks when the Remote-SSH clipboard channel stalls.** Under Remote-SSH, `vscode.env.clipboard.readText()` occasionally returns empty even when text is on the clipboard, which caused the webview to appear instead of a normal text paste. The fast path now retries once after a 30ms delay, and if the webview still opens, it can recover text (not just images) via the local `navigator.clipboard.read()` and inject it directly into the source terminal.

### Changed
- Webview bridge API: `readImage()` → `readClipboard()`; result shape now `{ type: 'image' | 'text' | 'none', ... }`.

## 0.1.0 — Initial release

- Paste clipboard images into Claude Code CLI over SSH via VS Code webview bridge.
- Cmd+V / Ctrl+V keybinding in integrated terminal.
- PNG / JPEG / GIF / WebP support, auto-cleanup after 1h (configurable).
