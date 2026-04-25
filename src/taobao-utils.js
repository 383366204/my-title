const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs');

const TAOBAO_NATIVE_PATH = process.env.TAOBAO_NATIVE_PATH ||
  '/mnt/c/Users/38336/AppData/Local/Programs/taobao/bin/taobao-native.cmd';

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
    console.log('🚀 正在启动淘宝桌面版...');
    const winPath = toWindowsPath(TAOBAO_NATIVE_PATH);
    await execAsync(`cmd.exe /c "${winPath}" launch`, { timeout: 10000 });
    console.log('✅ 淘宝桌面版已启动');
    return true;
  } catch (error) {
    console.warn('⚠️  启动淘宝桌面版失败:', error.message);
    return false;
  }
}

module.exports = {
  TAOBAO_NATIVE_PATH,
  isTaobaoNativeInstalled,
  toWindowsPath,
  launchTaobaoDesktop
};
