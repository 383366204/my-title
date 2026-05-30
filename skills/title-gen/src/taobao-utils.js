const { execFile, execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const DEFAULT_WSL_PATH = '/mnt/c/Users/38336/AppData/Local/Programs/taobao/bin/taobao-native.cmd';
const DEFAULT_WINDOWS_PATH = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'taobao', 'bin', 'taobao-native.cmd');
const TAOBAO_NATIVE_PATH = process.env.TAOBAO_NATIVE_PATH || DEFAULT_WSL_PATH;

let _desktopReady = false;
let _desktopLaunchPromise = null;
let _resolvedCliPath = null;

/**
 * Check whether a file exists.
 * @param {string} filePath - File path.
 * @returns {boolean} Whether the file exists.
 */
function pathExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Convert a Windows path to its WSL /mnt form.
 * @param {string} winPath - Windows path.
 * @returns {string} WSL-compatible path.
 */
function fromWindowsPath(winPath) {
  if (!winPath) return winPath;
  const normalized = String(winPath).replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return normalized;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

/**
 * Convert a WSL /mnt path to a Windows path.
 * @param {string} wslPath - WSL or Windows path.
 * @returns {string} Windows path.
 */
function toWindowsPath(wslPath) {
  if (!wslPath) return wslPath;
  if (/^[A-Za-z]:[\\/]/.test(wslPath)) return wslPath.replace(/\//g, '\\');
  return String(wslPath)
    .replace(/^\/mnt\/([a-z])\//i, (_, drive) => `${drive.toUpperCase()}:\\`)
    .replace(/\//g, '\\');
}

/**
 * Normalize a path for the current Node platform.
 * @param {string} filePath - Path or command.
 * @returns {string} Normalized path.
 */
function normalizePathForCurrentPlatform(filePath) {
  if (!filePath) return filePath;
  if (process.platform === 'win32' && /^\/mnt\/[a-z]\//i.test(filePath)) {
    return toWindowsPath(filePath);
  }
  if (process.platform !== 'win32' && /^[A-Za-z]:[\\/]/.test(filePath)) {
    return fromWindowsPath(filePath);
  }
  return filePath;
}

/**
 * Read taobao desktop install-location.txt candidates.
 * @returns {string[]} Candidate CLI paths.
 */
function readInstallLocationCandidates() {
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
    ...readInstallLocationCandidates(),
    DEFAULT_WINDOWS_PATH,
    fromWindowsPath(DEFAULT_WINDOWS_PATH),
    DEFAULT_WSL_PATH,
    findCliOnPath()
  ].filter(Boolean);

  for (const candidate of candidates) {
    const normalized = normalizePathForCurrentPlatform(candidate);
    if (pathExists(normalized)) {
      _resolvedCliPath = normalized;
      return _resolvedCliPath;
    }
  }

  return normalizePathForCurrentPlatform(configuredPath);
}

/**
 * Check whether taobao-native CLI is installed.
 * @returns {boolean} Whether the CLI can be found.
 */
function isTaobaoNativeInstalled() {
  return pathExists(resolveTaobaoNativePath());
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

/**
 * Run taobao-native synchronously.
 * @param {string[]} args - CLI args.
 * @param {object} options - execFileSync options.
 * @returns {Buffer|string} Command output.
 */
function runTaobaoNativeSync(args, options = {}) {
  return execFileSync(
    getCmdExecutable(),
    ['/d', '/s', '/c', toWindowsPath(resolveTaobaoNativePath()), ...args],
    options
  );
}

/**
 * Run taobao-native asynchronously.
 * @param {string[]} args - CLI args.
 * @param {object} options - exec options.
 * @returns {Promise<{stdout:string, stderr:string}>} Command result.
 */
function runTaobaoNativeAsync(args, options = {}) {
  return execFileAsync(
    getCmdExecutable(),
    ['/d', '/s', '/c', toWindowsPath(resolveTaobaoNativePath()), ...args],
    options
  );
}

/**
 * Launch Taobao desktop.
 * @returns {Promise<boolean>} Whether launch succeeded.
 */
async function launchTaobaoDesktop() {
  try {
    console.error('[taobao] launching Taobao desktop...');
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
  runTaobaoNativeSync,
  runTaobaoNativeAsync,
  launchTaobaoDesktop,
  ensureTaobaoDesktopReady,
  resetDesktopLaunchState
};
