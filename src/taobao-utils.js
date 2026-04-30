const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs');

const TAOBAO_NATIVE_PATH = process.env.TAOBAO_NATIVE_PATH ||
  '/mnt/c/Users/38336/AppData/Local/Programs/taobao/bin/taobao-native.cmd';

// 模块级淘宝桌面版启动状态（避免重复启动和等待）
let _desktopReady = false;
let _desktopLaunchPromise = null;

/**
 * 检测 taobao-native CLI 是否已安装
 * @returns {boolean} 是否已安装
 */
function isTaobaoNativeInstalled() {
  try {
    fs.accessSync(TAOBAO_NATIVE_PATH, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 将 WSL2 路径转换为 Windows 路径
 * @param {string} wslPath - WSL2 路径
 * @returns {string} Windows 路径
 */
function toWindowsPath(wslPath) {
  return wslPath.replace('/mnt/c/', 'C:\\').replace(/\//g, '\\');
}

/**
 * 启动淘宝桌面版
 * @returns {Promise<boolean>} 是否成功启动
 */
async function launchTaobaoDesktop() {
  try {
    console.error('🚀 正在启动淘宝桌面版...');
    const winPath = toWindowsPath(TAOBAO_NATIVE_PATH);
    await execAsync(`/mnt/c/Windows/System32/cmd.exe /c "${winPath}" launch`, { timeout: 10000 });
    console.error('✅ 淘宝桌面版已启动');
    return true;
  } catch (error) {
    console.warn('⚠️  启动淘宝桌面版失败:', error.message);
    return false;
  }
}

/**
 * 确保淘宝桌面版已启动并就绪（原子操作：启动 + 等待）
 * 同进程内多次调用只启动一次，后续调用直接返回
 * @returns {Promise<boolean>} 是否就绪
 */
async function ensureTaobaoDesktopReady() {
  // 已经就绪，直接返回
  if (_desktopReady) {
    return true;
  }
  
  // 已有启动任务在进行中，等待其完成
  if (_desktopLaunchPromise) {
    return _desktopLaunchPromise;
  }
  
  // 发起启动
  _desktopLaunchPromise = (async () => {
    try {
      const launched = await launchTaobaoDesktop();
      if (!launched) {
        _desktopLaunchPromise = null;
        return false;
      }
      // 等待桌面版就绪
      console.error('⏳ 等待淘宝桌面版准备就绪...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.error('✅ 淘宝桌面版准备就绪');
      _desktopReady = true;
      return true;
    } catch (err) {
      console.error('⚠️ 淘宝桌面版启动失败:', err.message);
      _desktopLaunchPromise = null;
      return false;
    }
  })();
  
  return _desktopLaunchPromise;
}

/**
 * 重置淘宝桌面版启动状态（搜索失败时调用，允许重新启动）
 */
function resetDesktopLaunchState() {
  _desktopReady = false;
  _desktopLaunchPromise = null;
}

module.exports = {
  TAOBAO_NATIVE_PATH,
  isTaobaoNativeInstalled,
  toWindowsPath,
  launchTaobaoDesktop,
  ensureTaobaoDesktopReady,
  resetDesktopLaunchState
};
