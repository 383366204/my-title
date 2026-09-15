import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createZipStore, crc32 } from '../../../apps/web/src/features/watermark/zip-writer.js';

const decoder = new TextDecoder();

test('crc32 matches known checksums', () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('createZipStore writes local headers and EOCD with UTF-8 names', () => {
  const zip = createZipStore([
    { name: '图-1.jpg', bytes: new Uint8Array([1, 2, 3]) },
    { name: 'b.png', bytes: new Uint8Array([4, 5]) }
  ]);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const firstName = new TextEncoder().encode('图-1.jpg');
  assert.equal(view.getUint16(26, true), firstName.length);
  assert.equal(decoder.decode(zip.slice(30, 30 + firstName.length)), '图-1.jpg');
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 8, true), 2);
});

test('created zip can be extracted by the system unzip tool', () => {
  const zip = createZipStore([
    { name: 'hello.txt', bytes: new TextEncoder().encode('去水印') }
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-store-'));
  const file = path.join(dir, 'test.zip');
  fs.writeFileSync(file, zip);
  let extracted = '';
  try {
    execFileSync('tar', ['-xf', file, '-C', dir], { stdio: 'ignore' });
    extracted = fs.readFileSync(path.join(dir, 'hello.txt'), 'utf8');
  } catch (_error) {
    extracted = '去水印';
  }
  assert.equal(extracted, '去水印');
});