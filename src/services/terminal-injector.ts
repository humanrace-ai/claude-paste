export interface TerminalLike {
  sendText(text: string, addNewLine?: boolean): void;
  name: string;
}

export interface TerminalProvider {
  getActiveTerminal(): TerminalLike | undefined;
}

export class TerminalInjectorService {
  private terminalProvider: TerminalProvider;

  constructor(terminalProvider: TerminalProvider) {
    this.terminalProvider = terminalProvider;
  }

  inject(filePath: string): void {
    const terminal = this.terminalProvider.getActiveTerminal();
    if (!terminal) {
      throw new Error('No active terminal available');
    }
    terminal.sendText(filePath, false);
  }
}
