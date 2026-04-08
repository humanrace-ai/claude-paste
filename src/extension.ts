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
    try {
      // Fast path: if clipboard has text, do a normal paste immediately
      const clipText = await vscode.env.clipboard.readText();
      if (clipText && clipText.length > 0) {
        console.log('[claude-paste] Clipboard has text, normal paste');
        await vscode.commands.executeCommand('workbench.action.terminal.paste');
        return;
      }

      // Clipboard text is empty -- likely an image. Open webview to auto-read.
      console.log('[claude-paste] Clipboard text empty, checking for image');
      const result = await clipboardBridge.readImage();

      if (!result.hasImage || !result.base64) {
        // No image either -- do normal paste (might paste nothing, that's fine)
        console.log('[claude-paste] No image found');
        await vscode.commands.executeCommand('workbench.action.terminal.paste');
        return;
      }

      const buffer = Buffer.from(result.base64, 'base64');

      if (buffer.length > cfg.maxImageSize) {
        vscode.window.showWarningMessage(
          `Claude Paste: Image too large (${(buffer.length / 1048576).toFixed(1)}MB, max ${(cfg.maxImageSize / 1048576).toFixed(0)}MB)`
        );
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
      terminalInjector.inject(filePath);

      vscode.window.showInformationMessage(`Claude Paste: ${path.basename(filePath)}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Claude Paste: ${err.message}`);
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
