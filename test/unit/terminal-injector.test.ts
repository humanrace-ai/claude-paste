import { describe, it, expect, vi } from 'vitest';
import {
  TerminalInjectorService,
  TerminalLike,
  TerminalProvider,
} from '../../src/services/terminal-injector';

function createMockTerminal(name = 'Terminal'): TerminalLike {
  return {
    sendText: vi.fn(),
    name,
  };
}

function createMockProvider(terminal?: TerminalLike): TerminalProvider {
  return {
    getActiveTerminal: () => terminal,
  };
}

describe('TerminalInjectorService', () => {
  it('sends file path to active terminal without newline', () => {
    const terminal = createMockTerminal();
    const provider = createMockProvider(terminal);
    const service = new TerminalInjectorService(provider);

    service.inject('/tmp/image.png');

    expect(terminal.sendText).toHaveBeenCalledWith('/tmp/image.png', false);
  });

  it('throws error when no active terminal', () => {
    const provider = createMockProvider(undefined);
    const service = new TerminalInjectorService(provider);

    expect(() => service.inject('/tmp/image.png')).toThrow(
      /no active terminal/i
    );
  });

  it('sends the correct path string', () => {
    const terminal = createMockTerminal();
    const provider = createMockProvider(terminal);
    const service = new TerminalInjectorService(provider);

    const path = '/home/user/screenshots/my image (1).png';
    service.inject(path);

    expect(terminal.sendText).toHaveBeenCalledWith(path, false);
  });

  it('does not append newline (sendText second arg is false)', () => {
    const terminal = createMockTerminal();
    const provider = createMockProvider(terminal);
    const service = new TerminalInjectorService(provider);

    service.inject('/tmp/test.png');

    const call = (terminal.sendText as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe(false);
  });

  it('handles terminal.sendText errors', () => {
    const terminal = createMockTerminal();
    (terminal.sendText as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('terminal write failed');
    });
    const provider = createMockProvider(terminal);
    const service = new TerminalInjectorService(provider);

    expect(() => service.inject('/tmp/image.png')).toThrow(
      'terminal write failed'
    );
  });
});
