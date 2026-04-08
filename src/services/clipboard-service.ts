import * as vscode from 'vscode';

export interface ClipboardContent {
  type: 'text' | 'image';
  text?: string;
  buffer?: Buffer;
  format?: 'png' | 'jpeg' | 'gif' | 'webp';
  size?: number;
}

export interface ClipboardServiceConfig {
  maxImageSize: number;
}

type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp';

const DATA_URI_REGEX = /^data:image\/(png|jpeg|gif|webp);base64,(.+)$/s;

/**
 * Check magic bytes to determine image format.
 * PNG:  89 50 4E 47
 * JPEG: FF D8 FF
 * GIF:  47 49 46 38
 * WebP: 52 49 46 46 .... 57 45 42 50
 */
function detectFormatFromBytes(buf: Buffer): ImageFormat | null {
  if (buf.length < 4) {
    return null;
  }

  // PNG: 89504E47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'png';
  }

  // JPEG: FFD8FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpeg';
  }

  // GIF: 47494638
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return 'gif';
  }

  // WebP: RIFF....WEBP (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'webp';
  }

  return null;
}

/**
 * Check if a string looks like base64-encoded image data.
 * Supports both data URIs (data:image/...) and raw base64.
 */
export function isBase64Image(text: string): boolean {
  if (!text) {
    return false;
  }

  // Check data URI format
  if (DATA_URI_REGEX.test(text)) {
    return true;
  }

  // Check if it could be raw base64 that decodes to image bytes
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.length >= 4) {
    try {
      const buf = Buffer.from(text, 'base64');
      return detectFormatFromBytes(buf) !== null;
    } catch {
      return false;
    }
  }

  return false;
}

export class ClipboardService {
  private config: ClipboardServiceConfig;
  private clipboardReader: () => Promise<string>;

  constructor(
    config: ClipboardServiceConfig,
    clipboardReader?: () => Promise<string>,
  ) {
    this.config = config;
    this.clipboardReader = clipboardReader ?? (async () => vscode.env.clipboard.readText() as unknown as string);
  }

  async read(): Promise<ClipboardContent> {
    const text = await this.clipboardReader();

    // Try data URI first
    const dataUriMatch = text.match(DATA_URI_REGEX);
    if (dataUriMatch) {
      const format = dataUriMatch[1] as ImageFormat;
      const base64Data = dataUriMatch[2];
      const buffer = Buffer.from(base64Data, 'base64');

      // Validate with magic bytes
      const detectedFormat = detectFormatFromBytes(buffer);
      if (detectedFormat) {
        if (buffer.length > this.config.maxImageSize) {
          return { type: 'text', text };
        }
        return {
          type: 'image',
          buffer,
          format: detectedFormat,
          size: buffer.length,
        };
      }
    }

    // Try raw base64
    if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.length >= 4) {
      try {
        const buffer = Buffer.from(text, 'base64');
        const format = detectFormatFromBytes(buffer);
        if (format) {
          if (buffer.length > this.config.maxImageSize) {
            return { type: 'text', text };
          }
          return {
            type: 'image',
            buffer,
            format,
            size: buffer.length,
          };
        }
      } catch {
        // Not valid base64, fall through to text
      }
    }

    return { type: 'text', text };
  }
}
