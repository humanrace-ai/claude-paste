import * as vscode from 'vscode';
import * as path from 'path';
import { ImageWriterService } from './services/image-writer';
import { TerminalInjectorService, TerminalProvider } from './services/terminal-injector';
import { CleanupService } from './services/cleanup-service';
import { WebviewClipboardBridge } from './services/webview-clipboard-bridge';

function getConfig() {
  const config = vscode.workspace.getConfiguration('claudePaste');
  return {
    imageTTL: config.get<number>('imageTTL', 3600),
    imageDir: config.get<string>('imageDir', '/tmp/claude-paste/images'),
    maxImageSize: config.get<number>('maxImageSize', 10485760),
    enableStatusBar: config.get<boolean>('enableStatusBar', true),
  };
}

export function activate(context: vscode.ExtensionContext) {
  const cfg = getConfig();

  const imageWriter = new ImageWriterService({
    imageDir: cfg.imageDir,
    maxImageSize: cfg.maxImageSize,
  });

  const terminalProvider: TerminalProvider = {
    getActiveTerminal() {
      const t = vscode.window.activeTerminal;
      return t ? { sendText: t.sendText.bind(t), name: t.name } : undefined;
    },
  };
  const terminalInjector = new TerminalInjectorService(terminalProvider);

  const clipboardBridge = new WebviewClipboardBridge(context);

  const cleanupService = new CleanupService(
    { imageDir: cfg.imageDir, imageTTL: cfg.imageTTL },
    { info: (msg) => console.log(`[claude-paste] ${msg}`), error: (msg) => console.error(`[claude-paste] ${msg}`) }
  );
  cleanupService.start();

  // Status bar
  if (cfg.enableStatusBar) {
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'claudePaste.pasteImage';
    statusBarItem.text = '$(file-media) Claude Paste';
    statusBarItem.tooltip = 'Paste clipboard image into terminal for Claude Code';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
  }

  // Main paste command -- bound to Cmd+V / Ctrl+V in terminal
  const pasteCommand = vscode.commands.registerCommand('claudePaste.pasteImage', async () => {
    // Capture the terminal that was active when the user invoked paste.
    // Once we open the webview it steals focus, so vscode.window.activeTerminal
    // becomes unreliable -- we need this reference to refocus afterward and
    // to inject into the right terminal.
    const sourceTerminal = vscode.window.activeTerminal;
    const refocus = () => {
      try {
        sourceTerminal?.show(false);
      } catch {
        // best-effort refocus
      }
    };

    try {
      // Fast path: extension-host clipboard read. Under Remote-SSH the
      // clipboard channel can stall briefly -- readText() returns '' even
      // when text is actually on the clipboard. Retry up to 6 times across
      // ~300ms to absorb the stall before falling through to the webview.
      let clipText = await vscode.env.clipboard.readText();
      for (let i = 0; i < 5 && !clipText; i++) {
        await new Promise((r) => setTimeout(r, 50));
        clipText = await vscode.env.clipboard.readText();
      }

      if (clipText && clipText.length > 0) {
        console.log('[claude-paste] Clipboard has text, normal paste');
        await vscode.commands.executeCommand('workbench.action.terminal.paste');
        return;
      }

      // Clipboard text is empty in the extension host. Could be an image,
      // or the host clipboard channel is in a stuck state (known Remote-SSH
      // quirk where readText returns empty even when text is present). The
      // webview runs locally and can read both directly.
      console.log('[claude-paste] Host clipboard text empty, opening webview');
      const result = await clipboardBridge.readClipboard();

      if (result.type === 'text' && result.text) {
        // Recovered text the host couldn't see. Inject it directly so we
        // don't bounce through the host clipboard again.
        console.log('[claude-paste] Recovered text via webview');
        if (sourceTerminal) {
          sourceTerminal.sendText(result.text, false);
          sourceTerminal.show(false);
        }
        return;
      }

      if (result.type !== 'image' || !result.base64) {
        console.log('[claude-paste] No content found');
        refocus();
        return;
      }

      const buffer = Buffer.from(result.base64, 'base64');

      if (buffer.length > cfg.maxImageSize) {
        vscode.window.showWarningMessage(
          `Claude Paste: Image too large (${(buffer.length / 1048576).toFixed(1)}MB, max ${(cfg.maxImageSize / 1048576).toFixed(0)}MB)`
        );
        refocus();
        return;
      }

      const formatMap: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpeg',
        'image/gif': 'gif',
        'image/webp': 'webp',
      };
      const format = formatMap[result.mimeType || ''] || 'png';

      const filePath = await imageWriter.write(buffer, format);

      // Inject into the captured source terminal directly. Falling back to
      // terminalInjector (which queries activeTerminal) only if we never had
      // one to begin with.
      // Trailing space so the user can immediately type after the path
      // without the cursor being jammed against the last character.
      if (sourceTerminal) {
        sourceTerminal.sendText(filePath + ' ', false);
        sourceTerminal.show(false);
      } else {
        terminalInjector.inject(filePath + ' ');
      }

      vscode.window.showInformationMessage(`Claude Paste: ${path.basename(filePath)}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Claude Paste: ${err.message}`);
      refocus();
    }
  });

  // Manual cleanup command
  const cleanupCommand = vscode.commands.registerCommand('claudePaste.cleanupImages', async () => {
    try {
      const count = await cleanupService.cleanup();
      vscode.window.showInformationMessage(`Claude Paste: Cleaned up ${count} expired image(s)`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Claude Paste: Cleanup failed - ${err.message}`);
    }
  });

  context.subscriptions.push(pasteCommand, cleanupCommand);
  context.subscriptions.push({ dispose: () => cleanupService.stop() });

  console.log('[claude-paste] Extension activated');
}

export function deactivate() {}
