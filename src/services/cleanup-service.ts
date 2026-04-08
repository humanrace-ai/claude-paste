import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CleanupConfig {
  imageDir: string;
  imageTTL: number; // seconds
  cleanupInterval?: number; // ms, default 600000 (10 min)
}

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

const defaultLogger: Logger = {
  info: () => {},
  error: () => {},
};

export class CleanupService {
  private config: CleanupConfig;
  private logger: Logger;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: CleanupConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger ?? defaultLogger;
  }

  private resolveDir(): string {
    let dir = this.config.imageDir;
    if (dir.startsWith('~')) {
      dir = path.join(os.homedir(), dir.slice(1));
    }
    return dir;
  }

  async cleanup(): Promise<number> {
    const dir = this.resolveDir();
    const cutoff = Date.now() - this.config.imageTTL * 1000;
    let deleted = 0;

    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      this.logger.info(`Cleanup: directory does not exist or is unreadable: ${dir}`);
      return 0;
    }

    for (const entry of entries) {
      const filePath = path.join(dir, entry);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          deleted++;
          this.logger.info(`Deleted expired file: ${filePath}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to process ${filePath}: ${msg}`);
      }
    }

    return deleted;
  }

  start(): void {
    const interval = this.config.cleanupInterval ?? 600000;
    this.timer = setInterval(() => {
      this.cleanup();
    }, interval);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
