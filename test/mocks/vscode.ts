// Mock VSCode API for unit testing outside of Extension Development Host

export const env = {
  clipboard: {
    readText: async () => '',
  },
};

export const window = {
  activeTerminal: undefined as any,
  showInformationMessage: (...args: any[]) => Promise.resolve(undefined),
  showErrorMessage: (...args: any[]) => Promise.resolve(undefined),
  showWarningMessage: (...args: any[]) => Promise.resolve(undefined),
  createStatusBarItem: (alignment?: any, priority?: number) => ({
    text: '',
    tooltip: '',
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  terminals: [] as any[],
};

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: (key: string, defaultValue?: any) => defaultValue,
    update: async () => {},
  }),
};

export const commands = {
  registerCommand: (command: string, callback: (...args: any[]) => any) => ({
    dispose: () => {},
  }),
  executeCommand: async (command: string, ...args: any[]) => {},
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export class Uri {
  static file(path: string) {
    return { fsPath: path, scheme: 'file', path };
  }
}

export class Disposable {
  static from(...disposables: { dispose: () => any }[]) {
    return {
      dispose: () => disposables.forEach((d) => d.dispose()),
    };
  }
}

export type ExtensionContext = {
  subscriptions: { dispose: () => any }[];
  extensionPath: string;
  globalStorageUri: { fsPath: string };
};
