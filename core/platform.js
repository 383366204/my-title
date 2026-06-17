const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function detectPlatform(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'darwin') return { kind: 'macos', platform };
  if (platform === 'win32') return { kind: 'windows', platform };
  if (platform === 'linux') {
    const procVersion = options.procVersion !== undefined ? options.procVersion : readProcVersion();
    const homeDir = options.homeDir || os.homedir();
    const isWsl = /microsoft|wsl/i.test(String(procVersion || '')) || /^\/mnt\/[a-z]\//i.test(String(homeDir || ''));
    return { kind: isWsl ? 'wsl' : 'linux', platform };
  }
  return { kind: platform || 'unknown', platform };
}

function readProcVersion() {
  try {
    return fs.readFileSync('/proc/version', 'utf8');
  } catch (_) {
    return '';
  }
}

function getHomeDir(options = {}) {
  return options.homeDir || process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function joinWindowsPath(...parts) {
  return parts
    .filter(part => part !== undefined && part !== null && String(part) !== '')
    .map((part, index) => {
      const value = String(part);
      if (index === 0) return value.replace(/[\\/]+$/, '');
      return value.replace(/^[\\/]+|[\\/]+$/g, '');
    })
    .join('\\');
}

function getHermesSkillsDir(options = {}) {
  return options.hermesSkillsDir
    || process.env.HERMES_SKILLS_DIR
    || path.join(getHomeDir(options), '.hermes', 'skills', 'ecommerce');
}

function getChromeProfileDir(profileName = 'default', options = {}) {
  const platform = options.platform || (options.osKind === 'windows' ? 'win32' : process.platform);
  const homeDir = getHomeDir(options);
  if (platform === 'win32' || options.osKind === 'windows') {
    return options.profileDir
      || process.env.ECOM_CHROME_PROFILE_DIR
      || joinWindowsPath(homeDir, '.hermes', 'chrome-profiles', profileName);
  }
  return options.profileDir
    || process.env.ECOM_CHROME_PROFILE_DIR
    || path.join(homeDir, '.hermes', 'chrome-profiles', profileName);
}

function fromWindowsPath(winPath) {
  if (!winPath) return winPath;
  const normalized = String(winPath).replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return normalized;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function toWindowsPath(posixPath) {
  if (!posixPath) return posixPath;
  if (/^[A-Za-z]:[\\/]/.test(posixPath)) return String(posixPath).replace(/\//g, '\\');
  return String(posixPath)
    .replace(/^\/mnt\/([a-z])\//i, (_, drive) => `${drive.toUpperCase()}:\\`)
    .replace(/\//g, '\\');
}

function normalizePathForPlatform(value, options = {}) {
  if (!value) return value;
  const platform = options.platform || process.platform;
  if (platform === 'win32' && /^\/mnt\/[a-z]\//i.test(value)) return toWindowsPath(value);
  if (platform !== 'win32' && /^[A-Za-z]:[\\/]/.test(value)) return fromWindowsPath(value);
  return value;
}

function pathExists(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath);
  } catch (_) {
    return false;
  }
}

function findChromeExecutable(options = {}) {
  const platformKind = options.osKind || detectPlatform(options).kind;
  if (options.chromePath) return options.chromePath;
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  if (platformKind === 'windows') {
    const localAppData = process.env.LOCALAPPDATA || joinWindowsPath(getHomeDir(options), 'AppData', 'Local');
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      joinWindowsPath(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    return candidates.find(pathExists) || candidates[0];
  }

  if (platformKind === 'macos') {
    if (pathExists('/Applications/Google Chrome.app')) return 'Google Chrome';
    if (pathExists('/Applications/Microsoft Edge.app')) return 'Microsoft Edge';
    return 'Google Chrome';
  }

  const candidates = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium', 'microsoft-edge', 'microsoft-edge-stable'];
  for (const candidate of candidates) {
    const found = spawnSync('sh', ['-lc', `command -v ${candidate}`], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return 'google-chrome';
}

function buildChromeLaunchPlan(options = {}) {
  const platformKind = options.osKind || detectPlatform(options).kind;
  const profileName = options.profileName || 'sycm';
  const port = options.port || 9222;
  const userDataDir = options.userDataDir || getChromeProfileDir(profileName, options);
  const chromePath = findChromeExecutable({ ...options, osKind: platformKind });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check'
  ];

  if (platformKind === 'macos') {
    return {
      osKind: platformKind,
      command: 'open',
      args: ['-na', chromePath, '--args', ...args],
      chromePath,
      userDataDir,
      port
    };
  }

  return {
    osKind: platformKind,
    command: chromePath,
    args,
    chromePath,
    userDataDir,
    port
  };
}

function findTaobaoNativePath(options = {}) {
  if (options.taobaoNativePath) return normalizePathForPlatform(options.taobaoNativePath, options);
  if (process.env.TAOBAO_NATIVE_PATH) return normalizePathForPlatform(process.env.TAOBAO_NATIVE_PATH, options);
  const platformKind = options.osKind || detectPlatform(options).kind;
  const homeDir = getHomeDir(options);
  if (platformKind === 'macos') {
    return path.join(homeDir, 'Library', 'Application Support', 'taobao', 'cli', 'bin', 'taobao-native');
  }
  if (platformKind === 'windows') {
    return joinWindowsPath(homeDir, 'AppData', 'Local', 'Programs', 'taobao', 'bin', 'taobao-native.cmd');
  }
  if (platformKind === 'wsl') {
    const match = String(homeDir || '').match(/\/mnt\/[a-z]\/Users\/([^/]+)/i);
    const winUser = match ? match[1] : '38336';
    return `/mnt/c/Users/${winUser}/AppData/Local/Programs/taobao/bin/taobao-native.cmd`;
  }
  return 'taobao-native';
}

module.exports = {
  detectPlatform,
  getHermesSkillsDir,
  getChromeProfileDir,
  findChromeExecutable,
  buildChromeLaunchPlan,
  findTaobaoNativePath,
  normalizePathForPlatform,
  toWindowsPath,
  fromWindowsPath,
  joinWindowsPath,
  pathExists
};
