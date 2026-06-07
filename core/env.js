const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');

let loaded = false;

/**
 * 加载项目环境变量，并用 Codex 用户级 env 补齐缺失项。
 *
 * @param {object} [options] - 加载配置
 * @param {string} [options.projectRoot] - 项目根目录
 * @param {string} [options.projectEnvPath] - 项目 .env 路径
 * @param {string} [options.codexEnvPath] - 用户级 Codex .env 路径
 * @param {boolean} [options.force] - 是否强制重新加载
 * @returns {{projectEnvPath: string, codexEnvPath: string, loadedProject: boolean, loadedCodex: boolean}}
 */
function loadEnv(options = {}) {
  if (loaded && !options.force) {
    return {
      projectEnvPath: options.projectEnvPath || path.resolve(__dirname, '..', '.env'),
      codexEnvPath: options.codexEnvPath || path.join(os.homedir(), '.codex', '.env'),
      loadedProject: false,
      loadedCodex: false
    };
  }

  const projectEnvPath = options.projectEnvPath || path.resolve(options.projectRoot || path.resolve(__dirname, '..'), '.env');
  const codexEnvPath = options.codexEnvPath || path.join(os.homedir(), '.codex', '.env');
  let loadedProject = false;
  let loadedCodex = false;

  // 项目 .env 优先，保证仓库本地配置可以覆盖用户级默认值。
  if (fs.existsSync(projectEnvPath)) {
    dotenv.config({ path: projectEnvPath, override: false });
    loadedProject = true;
  }

  // 用户级 Codex .env 只补齐缺失项，避免覆盖项目内显式配置。
  if (fs.existsSync(codexEnvPath)) {
    dotenv.config({ path: codexEnvPath, override: false });
    loadedCodex = true;
  }

  loaded = true;
  return { projectEnvPath, codexEnvPath, loadedProject, loadedCodex };
}

module.exports = { loadEnv };
