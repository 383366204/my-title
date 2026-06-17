const { execFile, execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const {
  detectPlatform,
  findTaobaoNativePath,
  fromWindowsPath: platformFromWindowsPath,
  normalizePathForPlatform,
  pathExists: platformPathExists,
  toWindowsPath: platformToWindowsPath
} = require('../../../core/platform');

const execFileAsync = util.promisify(execFile);

function isWsl() {
  return detectPlatform().kind === 'wsl';
}

const DEFAULT_WSL_PATH = findTaobaoNativePath({ osKind: 'wsl', homeDir: os.homedir() });
const DEFAULT_WINDOWS_PATH = findTaobaoNativePath({ osKind: 'windows', homeDir: os.homedir() });
const DEFAULT_MACOS_PATH = findTaobaoNativePath({ osKind: 'macos', homeDir: os.homedir() });
const DEFAULT_MACOS_RUNNER_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'taobao', 'cli', 'taobao-runner');
const DEFAULT_LINUX_COMMAND = 'taobao-native';
const TAOBAO_NATIVE_PATH = process.env.TAOBAO_NATIVE_PATH || (
  process.platform === 'darwin'
    ? DEFAULT_MACOS_PATH
    : process.platform === 'win32'
      ? DEFAULT_WINDOWS_PATH
      : isWsl()
        ? DEFAULT_WSL_PATH
        : DEFAULT_LINUX_COMMAND
);

let _desktopReady = false;
let _desktopLaunchPromise = null;
let _resolvedCliPath = null;

/**
 * Check whether a file exists.
 * @param {string} filePath - File path.
 * @returns {boolean} Whether the file exists.
 */
function pathExists(filePath) {
  if (!filePath || filePath === DEFAULT_LINUX_COMMAND) return false;
  return platformPathExists(filePath);
}

/**
 * Convert a Windows path to its WSL /mnt form.
 * @param {string} winPath - Windows path.
 * @returns {string} WSL-compatible path.
 */
function fromWindowsPath(winPath) {
  return platformFromWindowsPath(winPath);
}

/**
 * Convert a WSL /mnt path to a Windows path.
 * @param {string} wslPath - WSL or Windows path.
 * @returns {string} Windows path.
 */
function toWindowsPath(wslPath) {
  return platformToWindowsPath(wslPath);
}

/**
 * Normalize a path for the current Node platform.
 * @param {string} filePath - Path or command.
 * @returns {string} Normalized path.
 */
function normalizePathForCurrentPlatform(filePath) {
  return normalizePathForPlatform(filePath);
}

/**
 * Read taobao desktop install-location.txt candidates.
 * @returns {string[]} Candidate CLI paths.
 */
function readInstallLocationCandidates() {
  if (process.platform === 'darwin') {
    return [
      DEFAULT_MACOS_PATH,
      DEFAULT_MACOS_RUNNER_PATH
    ];
  }

  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const installFile = path.join(appData, 'taobao', 'install-location.txt');
  if (!pathExists(installFile)) return [];

  try {
    const installDir = fs.readFileSync(installFile, 'utf8').trim();
    return installDir ? [path.join(installDir, 'bin', 'taobao-native.cmd')] : [];
  } catch (_) {
    return [];
  }
}

/**
 * Find taobao-native through PATH.
 * @returns {string} CLI path, or empty string.
 */
function findCliOnPath() {
  const result = process.platform === 'win32'
    ? spawnSync('where.exe', ['taobao-native.cmd'], { encoding: 'utf8' })
    : spawnSync('sh', ['-lc', 'command -v taobao-native'], { encoding: 'utf8' });

  if (result.status !== 0 || !result.stdout) return '';
  const lines = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.find(line => /\.cmd$/i.test(line)) || lines[0] || '';
}

/**
 * Resolve taobao-native CLI path for Windows, WSL, and PATH installs.
 * @returns {string} Resolved CLI path.
 */
function resolveTaobaoNativePath() {
  if (_resolvedCliPath && pathExists(normalizePathForCurrentPlatform(_resolvedCliPath))) {
    return _resolvedCliPath;
  }

  const configuredPath = process.env.TAOBAO_NATIVE_PATH || TAOBAO_NATIVE_PATH;
  const candidates = [
    configuredPath,
    normalizePathForCurrentPlatform(configuredPath),
    findCliOnPath(),
    ...readInstallLocationCandidates(),
    DEFAULT_MACOS_PATH,
    DEFAULT_MACOS_RUNNER_PATH,
    DEFAULT_WINDOWS_PATH,
    fromWindowsPath(DEFAULT_WINDOWS_PATH),
    DEFAULT_WSL_PATH
  ].filter(Boolean);

  for (const candidate of candidates) {
    const normalized = normalizePathForCurrentPlatform(candidate);
    if (pathExists(normalized)) {
      _resolvedCliPath = normalized;
      return _resolvedCliPath;
    }
  }

  return findCliOnPath() || normalizePathForCurrentPlatform(configuredPath);
}

/**
 * Check whether taobao-native CLI is installed.
 * @returns {boolean} Whether the CLI can be found.
 */
function isTaobaoNativeInstalled() {
  const resolved = resolveTaobaoNativePath();
  return pathExists(resolved) || Boolean(findCliOnPath());
}

/**
 * Return the Windows cmd executable that can run .cmd files.
 * @returns {string} cmd executable.
 */
function getCmdExecutable() {
  return process.platform === 'win32'
    ? (process.env.ComSpec || 'cmd.exe')
    : '/mnt/c/Windows/System32/cmd.exe';
}

function commandForCurrentPlatform() {
  const cliPath = resolveTaobaoNativePath();
  const windowsCliPath = process.platform === 'win32'
    || /\.cmd$/i.test(cliPath)
    || /^\/mnt\/[a-z]\//i.test(cliPath)
    || /^[A-Za-z]:[\\/]/.test(cliPath);
  if (windowsCliPath) {
    return {
      command: getCmdExecutable(),
      argsPrefix: ['/d', '/s', '/c', toWindowsPath(cliPath)]
    };
  }
  return {
    command: cliPath,
    argsPrefix: []
  };
}

/**
 * Run taobao-native synchronously.
 * @param {string[]} args - CLI args.
 * @param {object} options - execFileSync options.
 * @returns {Buffer|string} Command output.
 */
function runTaobaoNativeSync(args, options = {}) {
  const command = commandForCurrentPlatform();
  return execFileSync(command.command, [...command.argsPrefix, ...args], options);
}

/**
 * Run taobao-native asynchronously.
 * @param {string[]} args - CLI args.
 * @param {object} options - exec options.
 * @returns {Promise<{stdout:string, stderr:string}>} Command result.
 */
function runTaobaoNativeAsync(args, options = {}) {
  const command = commandForCurrentPlatform();
  return execFileAsync(command.command, [...command.argsPrefix, ...args], options);
}

/**
 * Launch Taobao desktop.
 * @returns {Promise<boolean>} Whether launch succeeded.
 */
async function launchTaobaoDesktop() {
  try {
    console.error('[taobao] launching Taobao desktop...');
    if (process.platform === 'darwin' && pathExists('/Applications/淘宝桌面版.app')) {
      await execFileAsync('open', ['-a', '/Applications/淘宝桌面版.app'], { timeout: 10000 });
      console.error('[taobao] Taobao desktop launched');
      return true;
    }
    await runTaobaoNativeAsync(['launch'], { timeout: 10000 });
    console.error('[taobao] Taobao desktop launched');
    return true;
  } catch (error) {
    console.warn('[taobao] failed to launch Taobao desktop:', error.message);
    return false;
  }
}

/**
 * Ensure Taobao desktop is launched and ready.
 * @returns {Promise<boolean>} Whether desktop is ready.
 */
async function ensureTaobaoDesktopReady() {
  if (_desktopReady) return true;
  if (_desktopLaunchPromise) return _desktopLaunchPromise;

  _desktopLaunchPromise = (async () => {
    try {
      const launched = await launchTaobaoDesktop();
      if (!launched) {
        _desktopLaunchPromise = null;
        return false;
      }
      console.error('[taobao] waiting for Taobao desktop...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.error('[taobao] Taobao desktop ready');
      _desktopReady = true;
      return true;
    } catch (err) {
      console.error('[taobao] Taobao desktop startup failed:', err.message);
      _desktopLaunchPromise = null;
      return false;
    }
  })();

  return _desktopLaunchPromise;
}

/**
 * Reset Taobao desktop launch state.
 * @returns {void}
 */
function resetDesktopLaunchState() {
  _desktopReady = false;
  _desktopLaunchPromise = null;
}

module.exports = {
  TAOBAO_NATIVE_PATH,
  resolveTaobaoNativePath,
  isTaobaoNativeInstalled,
  toWindowsPath,
  fromWindowsPath,
  commandForCurrentPlatform,
  isWsl,
  runTaobaoNativeSync,
  runTaobaoNativeAsync,
  launchTaobaoDesktop,
  ensureTaobaoDesktopReady,
  resetDesktopLaunchState
};
