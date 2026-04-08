import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CleanupService, CleanupConfig, Logger } from '../../src/services/cleanup-service';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'));
}

function createFileWithAge(dir: string, name: string, ageSeconds: number): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, 'test-content');
  const mtime = new Date(Date.now() - ageSeconds * 1000);
  fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

describe('CleanupService', () => {
  let tmpDir: string;
  let logger: Logger;

  beforeEach(() => {
    tmpDir = makeTempDir();
    logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('cleanup()', () => {
    it('deletes files older than TTL', async () => {
      const oldFile = createFileWithAge(tmpDir, 'old.png', 3600); // 1 hour old
      const config: CleanupConfig = { imageDir: tmpDir, imageTTL: 1800 }; // 30 min TTL

      const service = new CleanupService(config, logger);
      const deleted = await service.cleanup();

      expect(deleted).toBe(1);
      expect(fs.existsSync(oldFile)).toBe(false);
    });

    it('keeps files newer than TTL', async () => {
      const newFile = createFileWithAge(tmpDir, 'new.png', 60); // 1 minute old
      const config: CleanupConfig = { imageDir: tmpDir, imageTTL: 1800 }; // 30 min TTL

      const service = new CleanupService(config, logger);
      const deleted = await service.cleanup();

      expect(deleted).toBe(0);
      expect(fs.existsSync(newFile)).toBe(true);
    });

    it('deletes old files and keeps new files in the same directory', async () => {
      const oldFile = createFileWithAge(tmpDir, 'old.png', 7200);
      const newFile = createFileWithAge(tmpDir, 'new.png', 60);
      const config: CleanupConfig = { imageDir: tmpDir, imageTTL: 3600 };

      const service = new CleanupService(config, logger);
      const deleted = await service.cleanup();

      expect(deleted).toBe(1);
      expect(fs.existsSync(oldFile)).toBe(false);
      expect(fs.existsSync(newFile)).toBe(true);
    });

    it('handles missing directory gracefully', async () => {
      const config: CleanupConfig = {
        imageDir: path.join(tmpDir, 'nonexistent'),
        imageTTL: 1800,
      };

      const service = new CleanupService(config, logger);
      const deleted = await service.cleanup();

      expect(deleted).toBe(0);
      // Should not throw, should log
    });

    it('handles empty directory', async () => {
      const config: CleanupConfig = { imageDir: tmpDir, imageTTL: 1800 };

      const service = new CleanupService(config, logger);
      const deleted = await service.cleanup();

      expect(deleted).toBe(0);
    });

    it('can be called manually', async () => {
      createFileWithAge(tmpDir, 'a.png', 3600);
      createFileWithAge(tmpDir, 'b.png', 3600);
      const config: CleanupConfig = { imageDir: tmpDir, imageTTL: 1800 };

      const service = new CleanupService(config, logger);
      const deleted = await service.cleanup();

      expect(deleted).toBe(2);
    });

    it('does not throw on permission errors and logs instead', async () => {
      const filePath = createFileWithAge(tmpDir, 'locked.png', 3600);
      // Make parent directory read-only so unlink fails
      fs.chmodSync(tmpDir, 0o555);

      const config: CleanupConfig = { imageDir: tmpDir, imageTTL: 1800 };
      const service = new CleanupService(config, logger);

      // Should not throw
      const deleted = await service.cleanup();

      expect(deleted).toBe(0);
      expect(logger.error).toHaveBeenCalled();

      // Restore permissions for cleanup in afterEach
      fs.chmodSync(tmpDir, 0o755);
    });

    it('resolves ~ in imageDir to home directory', async () => {
      // Create a temp dir inside homedir to test tilde expansion
      const homeSubDir = fs.mkdtempSync(path.join(os.homedir(), '.cleanup-test-'));
      try {
        createFileWithAge(homeSubDir, 'tilde.png', 3600);
        const relativePath = '~' + homeSubDir.slice(os.homedir().length);
        const config: CleanupConfig = { imageDir: relativePath, imageTTL: 1800 };

        const service = new CleanupService(config, logger);
        const deleted = await service.cleanup();

        expect(deleted).toBe(1);
      } finally {
        fs.rmSync(homeSubDir, { recursive: true, force: true });
      }
    });
  });

  describe('start() and stop()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('start() begins interval timer that calls cleanup', async () => {
      const config: CleanupConfig = {
        imageDir: tmpDir,
        imageTTL: 1800,
        cleanupInterval: 5000,
      };

      const service = new CleanupService(config, logger);
      const cleanupSpy = vi.spyOn(service, 'cleanup').mockResolvedValue(0);

      service.start();

      // Should not be called immediately
      expect(cleanupSpy).not.toHaveBeenCalled();

      // Advance past one interval
      vi.advanceTimersByTime(5000);
      expect(cleanupSpy).toHaveBeenCalledTimes(1);

      // Advance past another interval
      vi.advanceTimersByTime(5000);
      expect(cleanupSpy).toHaveBeenCalledTimes(2);

      service.stop();
    });

    it('stop() clears interval timer', async () => {
      const config: CleanupConfig = {
        imageDir: tmpDir,
        imageTTL: 1800,
        cleanupInterval: 5000,
      };

      const service = new CleanupService(config, logger);
      const cleanupSpy = vi.spyOn(service, 'cleanup').mockResolvedValue(0);

      service.start();
      service.stop();

      vi.advanceTimersByTime(10000);
      expect(cleanupSpy).not.toHaveBeenCalled();
    });

    it('uses default 600000ms interval when not specified', async () => {
      const config: CleanupConfig = { imageDir: tmpDir, imageTTL: 1800 };

      const service = new CleanupService(config, logger);
      const cleanupSpy = vi.spyOn(service, 'cleanup').mockResolvedValue(0);

      service.start();

      vi.advanceTimersByTime(599999);
      expect(cleanupSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(cleanupSpy).toHaveBeenCalledTimes(1);

      service.stop();
    });

    it('stop() is safe to call when not started', () => {
      const config: CleanupConfig = { imageDir: tmpDir, imageTTL: 1800 };
      const service = new CleanupService(config, logger);

      // Should not throw
      expect(() => service.stop()).not.toThrow();
    });
  });
});
