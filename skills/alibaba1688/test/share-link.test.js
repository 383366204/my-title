'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extract1688ShareUrls,
  parse1688ShareText,
  resolve1688ShareText
} = require('..');

const canonical = {
  offerId: '945020396141',
  url: 'https://detail.1688.com/offer/945020396141.html'
};

test('parses the encoded 1688 App protocol returned by a mobile share link', () => {
  const body = 'wireless1688://ma.m.1688.com/plugin?url=https%3A%2F%2Fm.1688.com%2Foffer%2F945020396141.html%3Fshare_token%3Dtoken%26offerId%3D945020396141%26__zhi_token%3DBguwABK30Dcav';
  assert.deepEqual(parse1688ShareText(body), canonical);
});

test('extracts only trusted 1688 URL candidates from pasted share text', () => {
  const input = '查看：https://qr.1688.com/s/1OHjjQID 其他：https://example.com/item';
  assert.deepEqual(extract1688ShareUrls(input), ['https://qr.1688.com/s/1OHjjQID']);
});

test('resolves a complete mobile share message through its short URL', async () => {
  const share = '【胡桃木云纱杯垫】复制￥BguwABK30Dcav￥，打开【手机阿里】查看：https://qr.1688.com/s/1OHjjQID CZ9885';
  const calls = [];
  const result = await resolve1688ShareText(share, {
    shortUrlResolver: async (url) => {
      calls.push(url);
      return 'https://m.1688.com/offer/945020396141.html?offerId=945020396141';
    }
  });
  assert.deepEqual(calls, ['https://qr.1688.com/s/1OHjjQID']);
  assert.deepEqual(result, canonical);
});
