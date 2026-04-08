import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClipboardService } from '../../src/services/clipboard-service';
import { ImageWriterService } from '../../src/services/image-writer';
import { TerminalInjectorService, TerminalProvider } from '../../src/services/terminal-injector';
import { CleanupService } from '../../src/services/cleanup-service';

describe('Integration: Full Paste Flow', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-paste-integration-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('clipboard image -> write to file -> inject path into terminal', async () => {
    // 1. Simulate clipboard with PNG data URI
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fakeImageData = Buffer.concat([pngHeader, Buffer.alloc(100, 0xAB)]);
    const base64 = `data:image/png;base64,${fakeImageData.toString('base64')}`;

    const clipboardService = new ClipboardService(
      { maxImageSize: 10485760 },
      async () => base64
    );

    // 2. Read clipboard
    const content = await clipboardService.read();
    expect(content.type).toBe('image');
    expect(content.format).toBe('png');
    expect(content.buffer).toBeDefined();

    // 3. Write image to disk
    const imageWriter = new ImageWriterService({
      imageDir: tmpDir,
      maxImageSize: 10485760,
    });
    const filePath = await imageWriter.write(content.buffer!, content.format!);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath.endsWith('.png')).toBe(true);

    const writtenData = fs.readFileSync(filePath);
    expect(writtenData.equals(content.buffer!)).toBe(true);

    // 4. Inject path into terminal
    const sentTexts: { text: string; addNewLine: boolean }[] = [];
    const mockTerminalProvider: TerminalProvider = {
      getActiveTerminal: () => ({
        name: 'Claude Code',
        sendText: (text: string, addNewLine?: boolean) => {
          sentTexts.push({ text, addNewLine: addNewLine ?? true });
        },
      }),
    };

    const injector = new TerminalInjectorService(mockTerminalProvider);
    injector.inject(filePath);

    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0].text).toBe(filePath);
    expect(sentTexts[0].addNewLine).toBe(false);
  });

  it('text clipboard falls through without writing files', async () => {
    const clipboardService = new ClipboardService(
      { maxImageSize: 10485760 },
      async () => 'just plain text'
    );

    const content = await clipboardService.read();
    expect(content.type).toBe('text');
    expect(content.text).toBe('just plain text');
    expect(content.buffer).toBeUndefined();
  });

  it('oversized image is treated as text', async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const bigImage = Buffer.concat([pngHeader, Buffer.alloc(1000, 0xAB)]);
    const base64 = `data:image/png;base64,${bigImage.toString('base64')}`;

    const clipboardService = new ClipboardService(
      { maxImageSize: 500 }, // very small limit
      async () => base64
    );

    const content = await clipboardService.read();
    expect(content.type).toBe('text');
  });

  it('cleanup removes old images after TTL', async () => {
    // Write a file and backdate it
    const filePath = path.join(tmpDir, 'old-image.png');
    fs.writeFileSync(filePath, Buffer.alloc(10));

    // Set mtime to 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 7200 * 1000);
    fs.utimesSync(filePath, twoHoursAgo, twoHoursAgo);

    // Write a recent file
    const recentPath = path.join(tmpDir, 'new-image.png');
    fs.writeFileSync(recentPath, Buffer.alloc(10));

    const cleanupService = new CleanupService({
      imageDir: tmpDir,
      imageTTL: 3600, // 1 hour
    });

    const deleted = await cleanupService.cleanup();

    expect(deleted).toBe(1);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(recentPath)).toBe(true);
  });

  it('full lifecycle: write -> inject -> cleanup', async () => {
    // Write
    const imageWriter = new ImageWriterService({
      imageDir: tmpDir,
      maxImageSize: 10485760,
    });
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const filePath = await imageWriter.write(Buffer.concat([pngHeader, Buffer.alloc(50)]), 'png');
    expect(fs.existsSync(filePath)).toBe(true);

    // Inject
    let injectedPath = '';
    const provider: TerminalProvider = {
      getActiveTerminal: () => ({
        name: 'test',
        sendText: (text: string) => { injectedPath = text; },
      }),
    };
    const injector = new TerminalInjectorService(provider);
    injector.inject(filePath);
    expect(injectedPath).toBe(filePath);

    // Backdate and cleanup
    const old = new Date(Date.now() - 7200 * 1000);
    fs.utimesSync(filePath, old, old);

    const cleanup = new CleanupService({ imageDir: tmpDir, imageTTL: 3600 });
    const count = await cleanup.cleanup();
    expect(count).toBe(1);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
