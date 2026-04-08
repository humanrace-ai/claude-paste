import * as vscode from 'vscode';

export interface WebviewClipboardResult {
  hasImage: boolean;
  base64?: string;
  mimeType?: string;
}

/**
 * Opens a small webview panel as a paste target. The user presses Cmd+V
 * in the webview, which captures the clipboard image via the paste event
 * (user gesture satisfies browser clipboard permissions). The image data
 * is sent back to the extension host via message passing.
 *
 * This works over Remote-SSH because webviews run in the LOCAL renderer.
 */
export class WebviewClipboardBridge {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  readImage(): Promise<WebviewClipboardResult> {
    return new Promise((resolve) => {
      const panel = vscode.window.createWebviewPanel(
        'claudePasteTarget',
        'Claude Paste - Press Cmd+V',
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        {
          enableScripts: true,
          retainContextWhenHidden: false,
        }
      );

      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          panel.dispose();
          resolve({ hasImage: false });
        }
      }, 15000);

      panel.onDidDispose(() => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          resolve({ hasImage: false });
        }
      });

      panel.webview.onDidReceiveMessage(
        (message: any) => {
          if (resolved) return;

          if (message.type === 'imageData') {
            resolved = true;
            clearTimeout(timeout);
            panel.dispose();
            resolve({
              hasImage: true,
              base64: message.base64,
              mimeType: message.mimeType,
            });
          } else if (message.type === 'textOnly') {
            resolved = true;
            clearTimeout(timeout);
            panel.dispose();
            resolve({ hasImage: false });
          } else if (message.type === 'cancel') {
            resolved = true;
            clearTimeout(timeout);
            panel.dispose();
            resolve({ hasImage: false });
          }
        },
        undefined,
        this.context.subscriptions
      );

      panel.webview.html = getPasteTargetHtml();
    });
  }
}

function getPasteTargetHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
  }
  #paste-zone {
    border: 3px dashed var(--vscode-focusBorder, #007acc);
    border-radius: 12px;
    padding: 48px 64px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    outline: none;
    min-width: 400px;
  }
  #paste-zone:focus {
    border-color: var(--vscode-focusBorder, #007acc);
    background: var(--vscode-editor-hoverHighlightBackground, rgba(0,122,204,0.1));
  }
  #paste-zone.success {
    border-color: #4ec964;
    background: rgba(78, 201, 100, 0.1);
  }
  h2 { font-size: 20px; margin-bottom: 8px; font-weight: 500; }
  p { font-size: 14px; opacity: 0.7; margin-bottom: 16px; }
  .kbd {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--vscode-widget-border, #555);
    background: var(--vscode-input-background, #333);
    font-family: monospace;
    font-size: 13px;
  }
  #preview { max-width: 300px; max-height: 200px; margin-top: 16px; display: none; border-radius: 4px; }
  #status { margin-top: 12px; font-size: 13px; }
  button {
    margin-top: 16px;
    padding: 6px 20px;
    border-radius: 4px;
    border: none;
    background: var(--vscode-button-background, #007acc);
    color: var(--vscode-button-foreground, #fff);
    cursor: pointer;
    font-size: 13px;
    display: none;
  }
  button:hover { opacity: 0.9; }
</style>
</head>
<body>
  <div id="paste-zone" tabindex="0" contenteditable="true">
    <h2>Paste your screenshot here</h2>
    <p>Press <span class="kbd">\u2318V</span> or <span class="kbd">Ctrl+V</span></p>
    <p>or right-click and Paste</p>
    <img id="preview" />
    <div id="status"></div>
    <button id="cancelBtn" onclick="cancel()">Cancel</button>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  const pasteZone = document.getElementById('paste-zone');
  const preview = document.getElementById('preview');
  const status = document.getElementById('status');
  const cancelBtn = document.getElementById('cancelBtn');

  cancelBtn.style.display = 'inline-block';

  // Auto-focus the paste zone
  pasteZone.focus();

  pasteZone.addEventListener('paste', async (e) => {
    e.preventDefault();

    const items = e.clipboardData?.items;
    if (!items) {
      status.textContent = 'No clipboard data available';
      return;
    }

    let foundImage = false;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        foundImage = true;
        const blob = item.getAsFile();
        if (!blob) {
          status.textContent = 'Could not read image from clipboard';
          return;
        }

        status.textContent = 'Reading image...';

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          // dataUrl looks like: data:image/png;base64,iVBOR...
          const commaIdx = dataUrl.indexOf(',');
          const base64 = dataUrl.substring(commaIdx + 1);
          const mimeType = item.type;

          // Show preview
          preview.src = dataUrl;
          preview.style.display = 'block';
          pasteZone.classList.add('success');
          status.textContent = 'Image captured! Sending to terminal...';

          // Send to extension
          vscode.postMessage({
            type: 'imageData',
            base64: base64,
            mimeType: mimeType
          });
        };
        reader.onerror = () => {
          status.textContent = 'Error reading image: ' + reader.error;
        };
        reader.readAsDataURL(blob);
        break;
      }
    }

    if (!foundImage) {
      status.textContent = 'No image in clipboard (text only)';
      vscode.postMessage({ type: 'textOnly' });
    }
  });

  // Also handle drag and drop
  pasteZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    pasteZone.classList.add('success');
  });
  pasteZone.addEventListener('dragleave', () => {
    pasteZone.classList.remove('success');
  });
  pasteZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const commaIdx = dataUrl.indexOf(',');
        const base64 = dataUrl.substring(commaIdx + 1);
        preview.src = dataUrl;
        preview.style.display = 'block';
        pasteZone.classList.add('success');
        status.textContent = 'Image captured! Sending to terminal...';
        vscode.postMessage({
          type: 'imageData',
          base64: base64,
          mimeType: file.type
        });
      };
      reader.readAsDataURL(file);
    }
  });

  function cancel() {
    vscode.postMessage({ type: 'cancel' });
  }

  // ESC to cancel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancel();
  });
</script>
</body>
</html>`;
}
