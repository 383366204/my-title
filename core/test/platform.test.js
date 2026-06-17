const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  detectPlatform,
  getHermesSkillsDir,
  getChromeProfileDir,
  buildChromeLaunchPlan,
  findTaobaoNativePath,
  normalizePathForPlatform,
  toWindowsPath,
  fromWindowsPath
} = require('../platform');

describe('platform helpers', () => {
  it('detects WSL separately from native Linux', () => {
    assert.equal(
      detectPlatform({ platform: 'linux', procVersion: 'Linux version 5.15.90.1-microsoft-standard-WSL2' }).kind,
      'wsl'
    );
    assert.equal(
      detectPlatform({ platform: 'linux', procVersion: 'Linux version 6.6.0-generic' }).kind,
      'linux'
    );
  });

  it('resolves cross-platform Hermes and Chrome profile directories', () => {
    const macHome = '/Users/demo';
    const winHome = 'C:\\Users\\demo';

    assert.equal(
      getHermesSkillsDir({ homeDir: macHome }),
      path.join(macHome, '.hermes', 'skills', 'ecommerce')
    );
    assert.equal(
      getChromeProfileDir('1688', { platform: 'darwin', homeDir: macHome }),
      path.join(macHome, '.hermes', 'chrome-profiles', '1688')
    );
    assert.equal(
      getChromeProfileDir('1688', { platform: 'win32', homeDir: winHome }),
      'C:\\Users\\demo\\.hermes\\chrome-profiles\\1688'
    );
  });

  it('converts Windows and WSL paths for the requested platform', () => {
    assert.equal(fromWindowsPath('C:\\Users\\demo\\project'), '/mnt/c/Users/demo/project');
    assert.equal(toWindowsPath('/mnt/c/Users/demo/project'), 'C:\\Users\\demo\\project');
    assert.equal(
      normalizePathForPlatform('/mnt/c/Users/demo/project', { platform: 'win32' }),
      'C:\\Users\\demo\\project'
    );
    assert.equal(
      normalizePathForPlatform('C:\\Users\\demo\\project', { platform: 'linux' }),
      '/mnt/c/Users/demo/project'
    );
  });

  it('builds Chrome launch plans for macOS, Linux, and Windows', () => {
    const mac = buildChromeLaunchPlan({ osKind: 'macos', port: 9333, profileName: 'sycm', homeDir: '/Users/demo' });
    assert.equal(mac.command, 'open');
    assert.deepEqual(mac.args.slice(0, 4), ['-na', 'Google Chrome', '--args', '--remote-debugging-port=9333']);
    assert.ok(mac.args.some(arg => arg.includes('/Users/demo/.hermes/chrome-profiles/sycm')));

    const linux = buildChromeLaunchPlan({ osKind: 'linux', chromePath: '/usr/bin/google-chrome', port: 9222, profileName: '1688', homeDir: '/home/demo' });
    assert.equal(linux.command, '/usr/bin/google-chrome');
    assert.ok(linux.args.includes('--remote-debugging-port=9222'));
    assert.ok(linux.args.some(arg => arg.includes('/home/demo/.hermes/chrome-profiles/1688')));

    const win = buildChromeLaunchPlan({ osKind: 'windows', chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', port: 9222, profileName: '1688', homeDir: 'C:\\Users\\demo' });
    assert.equal(win.command, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    assert.ok(win.args.includes('--remote-debugging-port=9222'));
    assert.ok(win.args.some(arg => arg.includes('C:\\Users\\demo\\.hermes\\chrome-profiles\\1688')));
  });

  it('resolves taobao-native defaults for macOS, Windows, WSL, and Linux', () => {
    assert.match(
      findTaobaoNativePath({ osKind: 'macos', homeDir: '/Users/demo' }),
      /\/Users\/demo\/Library\/Application Support\/taobao\/cli\/(?:bin\/taobao-native|taobao-runner)$/
    );
    assert.match(
      findTaobaoNativePath({ osKind: 'windows', homeDir: 'C:\\Users\\demo' }),
      /C:\\Users\\demo\\AppData\\Local\\Programs\\taobao\\bin\\taobao-native\.cmd$/
    );
    assert.match(
      findTaobaoNativePath({ osKind: 'wsl' }),
      /^\/mnt\/c\/Users\/[^/]+\/AppData\/Local\/Programs\/taobao\/bin\/taobao-native\.cmd$/
    );
    assert.equal(findTaobaoNativePath({ osKind: 'linux', homeDir: '/home/demo' }), 'taobao-native');
  });
});
