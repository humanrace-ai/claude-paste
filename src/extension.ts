import * as vscode from 'vscode';
import * as path from 'path';
import { ClipboardService } from './services/clipboard-service';
import { ImageWriterService } from './services/image-writer';
import { TerminalInjectorService, TerminalProvider } from './services/terminal-injector';
import { CleanupService } from './services/cleanup-service';

function getConfig() {
  const config = vscode.workspace.getConfiguration('claudePaste');
  return {
    imageTTL: config.get<number>('imageTTL', 3600),
    imageDir: config.get<string>('imageDir', '~/.claude-paste/images'),
    maxImageSize: config.get<number>('maxImageSize', 10485760),
    enableStatusBar: config.get<boolean>('enableStatusBar', true),
  };
}

export function activate(context: vscode.ExtensionContext) {
  const cfg = getConfig();

  // Initialize services
  const clipboardService = new ClipboardService({ maxImageSize: cfg.maxImageSize });

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

  const cleanupService = new CleanupService(
    { imageDir: cfg.imageDir, imageTTL: cfg.imageTTL },
    { info: (msg) => console.log(`[claude-paste] ${msg}`), error: (msg) => console.error(`[claude-paste] ${msg}`) }
  );
  cleanupService.start();

  // Status bar
  let statusBarItem: vscode.StatusBarItem | undefined;
  if (cfg.enableStatusBar) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'claudePaste.pasteImage';
    statusBarItem.text = '$(file-media) Paste';
    statusBarItem.tooltip = 'Claude Paste: Paste clipboard image into terminal';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
  }

  // Main paste command
  const pasteCommand = vscode.commands.registerCommand('claudePaste.pasteImage', async () => {
    try {
      const content = await clipboardService.read();

      if (content.type === 'text') {
        // No image on clipboard -- fall through to normal paste
        await vscode.commands.executeCommand('workbench.action.terminal.paste');
        return;
      }

      if (!content.buffer || !content.format) {
        vscode.window.showWarningMessage('Claude Paste: Could not read image from clipboard');
        return;
      }

      const filePath = await imageWriter.write(content.buffer, content.format);
      terminalInjector.inject(filePath);

      vscode.window.showInformationMessage(`Claude Paste: Image saved as ${path.basename(filePath)}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Claude Paste: ${err.message}`);
    }
  });

  // Cleanup command
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
}

export function deactivate() {
  // Cleanup handled by disposables
}
