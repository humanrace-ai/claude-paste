import * as vscode from 'vscode';

export interface WebviewClipboardResult {
  type: 'image' | 'text' | 'none';
  base64?: string;
  mimeType?: string;
  text?: string;
}

/**
 * Opens a webview that reads the clipboard. Tries navigator.clipboard.read()
 * first (no gesture needed). Falls back to a focused paste zone if permissions
 * block it. Works over Remote-SSH because webviews run LOCAL.
 *
 * Reads BOTH image and text. The text recovery path exists because
 * vscode.env.clipboard.readText() in the extension host occasionally returns
 * empty even when text is on the clipboard (stuck Remote-SSH clipboard
 * channel) -- the local webview can still see the real content.
 */
export class WebviewClipboardBridge {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  readClipboard(): Promise<WebviewClipboardResult> {
    return new Promise((resolve) => {
      const panel = vscode.window.createWebviewPanel(
        'claudePasteTarget',
        'Claude Paste',
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        {
          enableScripts: true,
          retainContextWhenHidden: false,
        }
      );

      let resolved = false;

      const finish = (result: WebviewClipboardResult) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        panel.dispose();
        resolve(result);
      };

      const timeout = setTimeout(() => finish({ type: 'none' }), 10000);

      panel.onDidDispose(() => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          resolve({ type: 'none' });
        }
      });

      panel.webview.onDidReceiveMessage(
        (message: any) => {
          if (resolved) return;

          switch (message.type) {
            case 'imageData':
              finish({ type: 'image', base64: message.base64, mimeType: message.mimeType });
              break;
            case 'textData':
              finish({ type: 'text', text: message.text });
              break;
            case 'noContent':
              finish({ type: 'none' });
              break;
            case 'needGesture':
              // Auto-read failed, webview shows paste UI -- just wait
              console.log('[claude-paste] Auto-read failed, waiting for user paste');
              break;
            case 'error':
              console.error('[claude-paste] Webview error:', message.error);
              finish({ type: 'none' });
              break;
          }
        },
        undefined,
        this.context.subscriptions
      );

      panel.webview.html = getAutoReadHtml();
    });
  }
}

function getAutoReadHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
  }
  #auto-status {
    font-size: 16px; margin-bottom: 20px;
  }
  #paste-zone {
    display: none;
    border: 3px dashed var(--vscode-focusBorder, #007acc);
    border-radius: 12px;
    padding: 40px 60px;
    text-align: center;
    outline: none;
    min-width: 400px;
  }
  #paste-zone:focus {
    background: var(--vscode-editor-hoverHighlightBackground, rgba(0,122,204,0.1));
  }
  #paste-zone.success {
    border-color: #4ec964;
    background: rgba(78, 201, 100, 0.1);
  }
  h2 { font-size: 18px; margin-bottom: 8px; font-weight: 500; }
  p { font-size: 13px; opacity: 0.7; }
  .kbd {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    border: 1px solid var(--vscode-widget-border, #555);
    background: var(--vscode-input-background, #333);
    font-family: monospace; font-size: 13px;
  }
  #status { margin-top: 12px; font-size: 13px; }
</style>
</head>
<body>
  <div id="auto-status">Reading clipboard...</div>
  <div id="paste-zone" tabindex="0" contenteditable="true">
    <h2>Paste your image here</h2>
    <p>Press <span class="kbd">Cmd+V</span> or <span class="kbd">Ctrl+V</span></p>
    <div id="status"></div>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  const autoStatus = document.getElementById('auto-status');
  const pasteZone = document.getElementById('paste-zone');
  const status = document.getElementById('status');

  function sendImage(blob, mimeType) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const commaIdx = dataUrl.indexOf(',');
      const base64 = dataUrl.substring(commaIdx + 1);
      vscode.postMessage({ type: 'imageData', base64, mimeType });
    };
    reader.onerror = () => {
      vscode.postMessage({ type: 'error', error: 'FileReader failed' });
    };
    reader.readAsDataURL(blob);
  }

  async function tryAutoRead() {
    try {
      const items = await navigator.clipboard.read();

      // Image first -- screenshots / image copies are the common reason
      // we end up in the webview path.
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            sendImage(blob, type);
            autoStatus.textContent = 'Got it!';
            return;
          }
        }
      }

      // No image -- recover text the extension host failed to see.
      for (const item of items) {
        for (const type of item.types) {
          if (type === 'text/plain') {
            const blob = await item.getType(type);
            const text = await blob.text();
            vscode.postMessage({ type: 'textData', text: text });
            autoStatus.textContent = 'Got text!';
            return;
          }
        }
      }

      vscode.postMessage({ type: 'noContent' });
    } catch (err) {
      // Permission denied -- show paste UI
      showPasteUI();
    }
  }

  function showPasteUI() {
    autoStatus.style.display = 'none';
    pasteZone.style.display = 'block';
    pasteZone.focus();
    vscode.postMessage({ type: 'needGesture' });

    pasteZone.addEventListener('paste', (e) => {
      e.preventDefault();
      const cd = e.clipboardData;
      if (!cd) {
        status.textContent = 'No clipboard data';
        vscode.postMessage({ type: 'noContent' });
        return;
      }

      // Image first
      const items = cd.items;
      if (items) {
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            if (!blob) {
              vscode.postMessage({ type: 'noContent' });
              return;
            }
            pasteZone.classList.add('success');
            status.textContent = 'Captured! Sending...';
            sendImage(blob, item.type);
            return;
          }
        }
      }

      // Then text
      const textData = cd.getData('text/plain');
      if (textData) {
        pasteZone.classList.add('success');
        status.textContent = 'Captured text! Sending...';
        vscode.postMessage({ type: 'textData', text: textData });
        return;
      }

      status.textContent = 'No content in clipboard';
      vscode.postMessage({ type: 'noContent' });
    });
  }

  // Escape to cancel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      vscode.postMessage({ type: 'noContent' });
    }
  });

  // Try auto-read immediately
  tryAutoRead();
</script>
</body>
</html>`;
}
