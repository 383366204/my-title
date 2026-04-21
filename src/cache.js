const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 关键词结果文件缓存
 * @param {string} cacheDir - 缓存目录路径
 * @param {number} ttlMs - 缓存过期时间（毫秒），默认 30 分钟
 */
class ResultCache {
  constructor({ cacheDir = '.cache', ttlMs = 30 * 60 * 1000 } = {}) {
    this.cacheDir = cacheDir;
    this.ttlMs = ttlMs;
  }

  _key(keyword, maxLength, limit) {
    const raw = `${keyword}::${maxLength}::${limit || 0}`;
    return crypto.createHash('md5').update(raw).digest('hex');
  }

  _path(key) {
    return path.join(this.cacheDir, `${key}.json`);
  }

  get(keyword, maxLength, limit) {
    try {
      const filePath = this._path(this._key(keyword, maxLength, limit));
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtimeMs > this.ttlMs) {
        fs.unlinkSync(filePath);
        return null;
      }
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  set(keyword, maxLength, limit, result) {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      const filePath = this._path(this._key(keyword, maxLength, limit));
      fs.writeFileSync(filePath, JSON.stringify(result), 'utf8');
    } catch {
      // cache write failure is non-critical
    }
  }
}

module.exports = { ResultCache };
