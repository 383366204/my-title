'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { prepareUploadImage } = require('../../../../skills/peer-discovery/src/upload-image');

test('preserves supported formats', async () => {
  const image = { extension: 'png', bytes: Buffer.from('image') };
  assert.equal(await prepareUploadImage(image), image);
});

test('converts WebP and removes temporary files', async () => {
  let dir;
  const result = await prepareUploadImage({ extension: 'webp', bytes: Buffer.from('webp') }, {
    platform: 'darwin', execute: async (_command, args) => {
      dir = path.dirname(args[3]);
      await fs.writeFile(args[5], Buffer.from('89504e470d0a1a0a', 'hex'));
    },
  });
  assert.equal(result.extension, 'png');
  await assert.rejects(fs.stat(dir), { code: 'ENOENT' });
});

test('cleans up failed conversion and rejects unsupported environments', async () => {
  let dir;
  await assert.rejects(prepareUploadImage({ extension: 'webp', bytes: Buffer.from('webp') }, {
    platform: 'darwin', execute: async (_command, args) => {
      dir = path.dirname(args[3]);
      throw new Error('decoder failed');
    },
  }), /decoder failed/);
  await assert.rejects(fs.stat(dir), { code: 'ENOENT' });
  await assert.rejects(prepareUploadImage({ extension: 'webp' }, { platform: 'linux' }), /无法转换/);
});
