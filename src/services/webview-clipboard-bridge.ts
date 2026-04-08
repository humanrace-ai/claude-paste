import * as vscode from 'vscode';

export interface WebviewClipboardResult {
  hasImage: boolean;
  base64?: string;
  mimeType?: string;
}

/**
 * Uses a hidden webview panel to access navigator.clipboard.read()
 * which CAN read binary image data -- unlike vscode.env.clipboard
 * which only reads text.
 *
 * This works in Remote-SSH because the webview runs in the LOCAL
 * renderer process (Electron/browser), not on the remote host.
 */
export class WebviewClipboardBridge {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async readImage(): Promise<WebviewClipboardResult> {
    return new Promise((resolve) => {
      const panel = vscode.window.createWebviewPanel(
        'claudePasteClipboard',
        'Clipboard Reader',
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
        {
          enableScripts: true,
          retainContextWhenHidden: false,
        }
      );

      // Hide the panel as much as possible
      const timeout = setTimeout(() => {
        panel.dispose();
        resolve({ hasImage: false });
      }, 3000);

      panel.webview.onDidReceiveMessage(
        (message: any) => {
          clearTimeout(timeout);
          panel.dispose();
          if (message.type === 'clipboardResult') {
            resolve({
              hasImage: message.hasImage,
              base64: message.base64,
              mimeType: message.mimeType,
            });
          } else {
            resolve({ hasImage: false });
          }
        },
        undefined,
        this.context.subscriptions
      );

      panel.webview.html = getClipboardReaderHtml();
    });
  }
}

function getClipboardReaderHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<script>
  const vscode = acquireVsCodeApi();

  async function readClipboard() {
    try {
      // Check if clipboard API is available
      if (!navigator.clipboard || !navigator.clipboard.read) {
        vscode.postMessage({ type: 'clipboardResult', hasImage: false, error: 'Clipboard API not available' });
        return;
      }

      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const buffer = await blob.arrayBuffer();
            const uint8 = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < uint8.length; i++) {
              binary += String.fromCharCode(uint8[i]);
            }
            const base64 = btoa(binary);
            vscode.postMessage({
              type: 'clipboardResult',
              hasImage: true,
              base64: base64,
              mimeType: type
            });
            return;
          }
        }
      }
      vscode.postMessage({ type: 'clipboardResult', hasImage: false });
    } catch (err) {
      vscode.postMessage({ type: 'clipboardResult', hasImage: false, error: String(err) });
    }
  }

  readClipboard();
</script>
</body>
</html>`;
}
