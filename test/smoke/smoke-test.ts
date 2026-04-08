/**
 * Smoke test: exercises real services end-to-end without VSCode runtime.
 * Validates the full pipeline: clipboard read -> image write -> terminal inject -> cleanup.
 * Run with: npx tsx test/smoke/smoke-test.ts
 */

// Register vscode mock before any service imports
import Module from 'module';
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') {
    return require.resolve('../mocks/vscode');
  }
  return originalResolve.call(this, request, ...args);
};

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClipboardService } from '../../src/services/clipboard-service';
import { ImageWriterService } from '../../src/services/image-writer';
import { TerminalInjectorService } from '../../src/services/terminal-injector';
import { CleanupService } from '../../src/services/cleanup-service';

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}`);
    failed++;
  }
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-paste-smoke-'));
  console.log(`\nSmoke test dir: ${tmpDir}\n`);

  // --- 1. Clipboard Service: PNG data URI ---
  console.log('1. ClipboardService');
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngBody = Buffer.alloc(256, 0xAB);
  const pngBuffer = Buffer.concat([pngMagic, pngBody]);
  const dataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;

  const clipboard = new ClipboardService({ maxImageSize: 10485760 }, async () => dataUri);
  const content = await clipboard.read();
  assert(content.type === 'image', 'detects image type');
  assert(content.format === 'png', 'detects PNG format');
  assert(content.buffer !== undefined, 'buffer is present');
  assert(content.size === pngBuffer.length, `size matches (${content.size} === ${pngBuffer.length})`);
  assert(content.buffer!.equals(pngBuffer), 'buffer data matches original');

  // --- 2. Clipboard Service: JPEG data URI ---
  console.log('\n2. ClipboardService (JPEG)');
  const jpegMagic = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
  const jpegBody = Buffer.alloc(128, 0xCD);
  const jpegBuffer = Buffer.concat([jpegMagic, jpegBody]);
  const jpegUri = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;

  const clipboard2 = new ClipboardService({ maxImageSize: 10485760 }, async () => jpegUri);
  const content2 = await clipboard2.read();
  assert(content2.type === 'image', 'detects JPEG image type');
  assert(content2.format === 'jpeg', 'detects JPEG format');

  // --- 3. Clipboard Service: plain text fallback ---
  console.log('\n3. ClipboardService (text fallback)');
  const clipboard3 = new ClipboardService({ maxImageSize: 10485760 }, async () => 'hello world');
  const content3 = await clipboard3.read();
  assert(content3.type === 'text', 'text clipboard returns text type');
  assert(content3.text === 'hello world', 'text content preserved');

  // --- 4. Clipboard Service: oversized image ---
  console.log('\n4. ClipboardService (oversized)');
  const clipboard4 = new ClipboardService({ maxImageSize: 100 }, async () => dataUri);
  const content4 = await clipboard4.read();
  assert(content4.type === 'text', 'oversized image treated as text');

  // --- 5. ImageWriterService ---
  console.log('\n5. ImageWriterService');
  const writer = new ImageWriterService({ imageDir: tmpDir, maxImageSize: 10485760 });
  const filePath = await writer.write(pngBuffer, 'png');
  assert(fs.existsSync(filePath), 'file exists on disk');
  assert(filePath.endsWith('.png'), 'has .png extension');
  assert(filePath.startsWith(tmpDir), 'written to correct directory');
  const readBack = fs.readFileSync(filePath);
  assert(readBack.equals(pngBuffer), 'file contents match written buffer');

  // Write a second file to test uniqueness
  const filePath2 = await writer.write(jpegBuffer, 'jpeg');
  assert(filePath2 !== filePath, 'unique filenames');
  assert(filePath2.endsWith('.jpeg'), 'has .jpeg extension');

  // Oversized write should throw
  let threwOnOversize = false;
  try {
    const tinyWriter = new ImageWriterService({ imageDir: tmpDir, maxImageSize: 10 });
    await tinyWriter.write(pngBuffer, 'png');
  } catch {
    threwOnOversize = true;
  }
  assert(threwOnOversize, 'rejects oversized buffer');

  // --- 6. TerminalInjectorService ---
  console.log('\n6. TerminalInjectorService');
  const injected: string[] = [];
  const injector = new TerminalInjectorService({
    getActiveTerminal: () => ({
      name: 'test-terminal',
      sendText: (text: string, addNewLine?: boolean) => {
        injected.push(text);
        assert(addNewLine === false, 'sendText called with addNewLine=false');
      },
    }),
  });
  injector.inject(filePath);
  assert(injected.length === 1, 'injected exactly once');
  assert(injected[0] === filePath, 'injected correct path');

  // No terminal should throw
  let threwNoTerminal = false;
  const noTermInjector = new TerminalInjectorService({ getActiveTerminal: () => undefined });
  try {
    noTermInjector.inject('/tmp/foo.png');
  } catch (e: any) {
    threwNoTerminal = e.message.includes('No active terminal');
  }
  assert(threwNoTerminal, 'throws on missing terminal');

  // --- 7. CleanupService ---
  console.log('\n7. CleanupService');
  // Backdate the first file to trigger cleanup
  const twoHoursAgo = new Date(Date.now() - 7200_000);
  fs.utimesSync(filePath, twoHoursAgo, twoHoursAgo);

  const logs: string[] = [];
  const cleanup = new CleanupService(
    { imageDir: tmpDir, imageTTL: 3600 },
    { info: (msg) => logs.push(msg), error: (msg) => logs.push(`ERR: ${msg}`) },
  );

  const deleted = await cleanup.cleanup();
  assert(deleted === 1, `deleted 1 expired file (got ${deleted})`);
  assert(!fs.existsSync(filePath), 'expired file removed');
  assert(fs.existsSync(filePath2), 'recent file preserved');

  // Second cleanup should find nothing
  const deleted2 = await cleanup.cleanup();
  assert(deleted2 === 0, 'no files to delete on second run');

  // --- 8. Tilde resolution ---
  console.log('\n8. Path resolution');
  const homeWriter = new ImageWriterService({ imageDir: '~/.claude-paste/images', maxImageSize: 10485760 });
  const resolved = homeWriter.resolveDir('~/.claude-paste/images');
  assert(resolved.startsWith(os.homedir()), `~ resolves to homedir (${resolved})`);
  assert(!resolved.includes('~'), 'no tilde in resolved path');

  // --- 9. Cleanup start/stop lifecycle ---
  console.log('\n9. Cleanup lifecycle');
  const lifecycle = new CleanupService({ imageDir: tmpDir, imageTTL: 3600, cleanupInterval: 60000 });
  lifecycle.start();
  assert(true, 'start() does not throw');
  lifecycle.stop();
  assert(true, 'stop() does not throw');
  lifecycle.stop(); // double stop
  assert(true, 'double stop() safe');

  // --- Teardown ---
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // --- Summary ---
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Smoke test: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
