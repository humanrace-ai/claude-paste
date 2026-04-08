import { describe, it, expect, vi } from 'vitest';
import { ClipboardService, ClipboardContent, isBase64Image } from '../../src/services/clipboard-service';

// Helper to create a data URI from raw bytes
function toDataUri(format: string, bytes: number[]): string {
  const buf = Buffer.from(bytes);
  return `data:image/${format};base64,${buf.toString('base64')}`;
}

// PNG magic bytes: 89 50 4E 47
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// JPEG magic bytes: FF D8 FF
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
// GIF magic bytes: 47 49 46 38
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
// WebP magic bytes: RIFF....WEBP
const WEBP_MAGIC = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

describe('ClipboardService', () => {
  describe('read()', () => {
    it('returns text type when clipboard has plain text', async () => {
      const reader = async () => 'hello world';
      const service = new ClipboardService({ maxImageSize: 10 * 1024 * 1024 }, reader);

      const result = await service.read();

      expect(result.type).toBe('text');
      expect(result.text).toBe('hello world');
      expect(result.buffer).toBeUndefined();
      expect(result.format).toBeUndefined();
    });

    it('detects base64 PNG image in clipboard text', async () => {
      const dataUri = toDataUri('png', PNG_MAGIC);
      const reader = async () => dataUri;
      const service = new ClipboardService({ maxImageSize: 10 * 1024 * 1024 }, reader);

      const result = await service.read();

      expect(result.type).toBe('image');
      expect(result.format).toBe('png');
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('detects base64 JPEG image in clipboard text', async () => {
      const dataUri = toDataUri('jpeg', JPEG_MAGIC);
      const reader = async () => dataUri;
      const service = new ClipboardService({ maxImageSize: 10 * 1024 * 1024 }, reader);

      const result = await service.read();

      expect(result.type).toBe('image');
      expect(result.format).toBe('jpeg');
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('returns correct buffer and format for base64 images', async () => {
      const pngBytes = [...PNG_MAGIC, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52];
      const dataUri = toDataUri('png', pngBytes);
      const reader = async () => dataUri;
      const service = new ClipboardService({ maxImageSize: 10 * 1024 * 1024 }, reader);

      const result = await service.read();

      expect(result.type).toBe('image');
      expect(result.format).toBe('png');
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.size).toBe(pngBytes.length);
      // Verify the decoded buffer matches original bytes
      const expected = Buffer.from(pngBytes);
      expect(result.buffer!.equals(expected)).toBe(true);
    });

    it('handles empty clipboard', async () => {
      const reader = async () => '';
      const service = new ClipboardService({ maxImageSize: 10 * 1024 * 1024 }, reader);

      const result = await service.read();

      expect(result.type).toBe('text');
      expect(result.text).toBe('');
    });

    it('validates image size against max limit', async () => {
      // Create a data URI with bytes exceeding a tiny max size
      const bigBytes = new Array(100).fill(0x89);
      // Overwrite first bytes with PNG magic so it's detected as image
      bigBytes[0] = 0x89; bigBytes[1] = 0x50; bigBytes[2] = 0x4e; bigBytes[3] = 0x47;
      const dataUri = toDataUri('png', bigBytes);
      const reader = async () => dataUri;
      const service = new ClipboardService({ maxImageSize: 50 }, reader);

      const result = await service.read();

      expect(result.type).toBe('text');
      expect(result.text).toBe(dataUri);
    });

    it('detects GIF images', async () => {
      const dataUri = toDataUri('gif', GIF_MAGIC);
      const reader = async () => dataUri;
      const service = new ClipboardService({ maxImageSize: 10 * 1024 * 1024 }, reader);

      const result = await service.read();

      expect(result.type).toBe('image');
      expect(result.format).toBe('gif');
    });

    it('detects WebP images', async () => {
      const dataUri = toDataUri('webp', WEBP_MAGIC);
      const reader = async () => dataUri;
      const service = new ClipboardService({ maxImageSize: 10 * 1024 * 1024 }, reader);

      const result = await service.read();

      expect(result.type).toBe('image');
      expect(result.format).toBe('webp');
    });

    it('detects raw base64 image data without data URI prefix', async () => {
      // Raw base64 of PNG magic bytes (no data:image/... prefix)
      const rawBase64 = Buffer.from(PNG_MAGIC).toString('base64');
      const reader = async () => rawBase64;
      const service = new ClipboardService({ maxImageSize: 10 * 1024 * 1024 }, reader);

      const result = await service.read();

      expect(result.type).toBe('image');
      expect(result.format).toBe('png');
    });
  });

  describe('isBase64Image()', () => {
    it('correctly identifies data URIs', () => {
      expect(isBase64Image('data:image/png;base64,iVBORw==')).toBe(true);
      expect(isBase64Image('data:image/jpeg;base64,/9j/4A==')).toBe(true);
      expect(isBase64Image('data:image/gif;base64,R0lGODlh')).toBe(true);
      expect(isBase64Image('data:image/webp;base64,UklGR')).toBe(true);
    });

    it('rejects non-image data URIs', () => {
      expect(isBase64Image('data:text/plain;base64,aGVsbG8=')).toBe(false);
    });

    it('rejects plain text', () => {
      expect(isBase64Image('hello world')).toBe(false);
      expect(isBase64Image('')).toBe(false);
    });

    it('identifies raw base64 that decodes to image magic bytes', () => {
      const pngBase64 = Buffer.from(PNG_MAGIC).toString('base64');
      expect(isBase64Image(pngBase64)).toBe(true);
    });

    it('rejects raw base64 that does not decode to image magic bytes', () => {
      const textBase64 = Buffer.from('hello world').toString('base64');
      expect(isBase64Image(textBase64)).toBe(false);
    });
  });
});
