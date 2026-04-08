import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ImageWriterService, ImageWriterConfig } from '../../src/services/image-writer';

describe('ImageWriterService', () => {
  let testDir: string;
  let service: ImageWriterService;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `claude-paste-test-${Date.now()}`);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createService(overrides: Partial<ImageWriterConfig> = {}): ImageWriterService {
    const config: ImageWriterConfig = {
      imageDir: testDir,
      maxImageSize: 10 * 1024 * 1024, // 10MB
      ...overrides,
    };
    return new ImageWriterService(config);
  }

  describe('directory creation', () => {
    it('creates image directory if it does not exist', async () => {
      const nestedDir = path.join(testDir, 'nested', 'deep');
      service = createService({ imageDir: nestedDir });
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes

      await service.write(buf, 'png');

      expect(fs.existsSync(nestedDir)).toBe(true);
    });
  });

  describe('file writing', () => {
    it('writes PNG buffer to file with .png extension', async () => {
      service = createService();
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      const filePath = await service.write(buf, 'png');

      expect(filePath.endsWith('.png')).toBe(true);
      const written = fs.readFileSync(filePath);
      expect(Buffer.compare(written, buf)).toBe(0);
    });

    it('writes JPEG buffer to file with .jpeg extension', async () => {
      service = createService();
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

      const filePath = await service.write(buf, 'jpeg');

      expect(filePath.endsWith('.jpeg')).toBe(true);
      const written = fs.readFileSync(filePath);
      expect(Buffer.compare(written, buf)).toBe(0);
    });
  });

  describe('filename generation', () => {
    it('generates UUID-based filenames', async () => {
      service = createService();
      const buf = Buffer.from([0x89, 0x50]);

      const filePath = await service.write(buf, 'png');
      const filename = path.basename(filePath, '.png');

      // UUID v4 format: 8-4-4-4-12 hex chars
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(filename).toMatch(uuidRegex);
    });

    it('generates unique filenames on successive writes', async () => {
      service = createService();
      const buf = Buffer.from([0x89, 0x50]);

      const path1 = await service.write(buf, 'png');
      const path2 = await service.write(buf, 'png');

      expect(path1).not.toBe(path2);
    });
  });

  describe('path resolution', () => {
    it('returns absolute file path', async () => {
      service = createService();
      const buf = Buffer.from([0x89, 0x50]);

      const filePath = await service.write(buf, 'png');

      expect(path.isAbsolute(filePath)).toBe(true);
    });

    it('resolves ~ to home directory', () => {
      service = createService();
      const resolved = service.resolveDir('~/some/path');

      expect(resolved).toBe(path.join(os.homedir(), 'some/path'));
      expect(resolved.startsWith('~')).toBe(false);
    });

    it('leaves absolute paths unchanged', () => {
      service = createService();
      const resolved = service.resolveDir('/absolute/path');

      expect(resolved).toBe('/absolute/path');
    });
  });

  describe('size validation', () => {
    it('rejects files exceeding max size', async () => {
      service = createService({ maxImageSize: 100 });
      const buf = Buffer.alloc(200); // 200 bytes, exceeds 100 byte limit

      await expect(service.write(buf, 'png')).rejects.toThrow(/exceeds maximum/i);
    });

    it('accepts files within max size', async () => {
      service = createService({ maxImageSize: 1000 });
      const buf = Buffer.alloc(500);

      const filePath = await service.write(buf, 'png');

      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('handles write errors gracefully', async () => {
      // Use an invalid path that cannot be created
      service = createService({ imageDir: '/dev/null/impossible/path' });
      const buf = Buffer.from([0x89, 0x50]);

      await expect(service.write(buf, 'png')).rejects.toThrow();
    });
  });
});
