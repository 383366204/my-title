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
    this._bannedHash = null;
  }

  _getBannedWordsHash() {
    if (!this._bannedHash) {
      try {
        const bw = require('../data/banned-words.json');
        this._bannedHash = crypto.createHash('md5').update(JSON.stringify(bw)).digest('hex').slice(0, 8);
      } catch (_) {
        this._bannedHash = 'none';
      }
    }
    return this._bannedHash;
  }

  _key(keyword, maxLength, limit, peerTitlesHash = '') {
    const bannedVersion = this._getBannedWordsHash();
    const raw = `${keyword}::${maxLength}::${limit || 0}::${peerTitlesHash}::${bannedVersion}`;
    return crypto.createHash('md5').update(raw).digest('hex');
  }

  _path(key) {
    return path.join(this.cacheDir, `${key}.json`);
  }

  get(keyword, maxLength, limit, peerTitlesHash = '') {
    try {
      const filePath = this._path(this._key(keyword, maxLength, limit, peerTitlesHash));
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

  set(keyword, maxLength, limit, result, peerTitlesHash = '') {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      const filePath = this._path(this._key(keyword, maxLength, limit, peerTitlesHash));
      fs.writeFileSync(filePath, JSON.stringify(result), 'utf8');
      // 随机触发过期清理（10% 概率）
      if (Math.random() < 0.1) this._cleanExpired();
    } catch {
      // cache write failure is non-critical
    }
  }

  _cleanExpired() {
    try {
      const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.json'));
      let cleaned = 0;
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (Date.now() - stat.mtimeMs > this.ttlMs) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        } catch (_) {}
      }
      if (cleaned > 0) console.log(`🧹 清理 ${cleaned} 个过期缓存文件`);
    } catch (_) {}
  }
}

module.exports = { ResultCache };
