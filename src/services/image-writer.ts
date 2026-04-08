import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export interface ImageWriterConfig {
  imageDir: string;
  maxImageSize: number;
}

export class ImageWriterService {
  private config: ImageWriterConfig;

  constructor(config: ImageWriterConfig) {
    this.config = {
      ...config,
      imageDir: this.resolveDir(config.imageDir),
    };
  }

  async write(buffer: Buffer, format: string): Promise<string> {
    if (buffer.length > this.config.maxImageSize) {
      throw new Error(
        `Image size (${buffer.length} bytes) exceeds maximum allowed size (${this.config.maxImageSize} bytes)`
      );
    }

    const dir = this.config.imageDir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });

    const filename = `${crypto.randomUUID()}.${format}`;
    const filePath = path.join(dir, filename);

    await fs.promises.writeFile(filePath, buffer, { mode: 0o644 });

    return filePath;
  }

  resolveDir(dir: string): string {
    if (dir.startsWith('~/') || dir === '~') {
      return path.join(os.homedir(), dir.slice(2));
    }
    return dir;
  }
}
