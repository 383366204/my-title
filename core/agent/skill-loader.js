/**
 * @file skill-loader.js
 * @description ADR D10 文件级 Skill 索引与按需加载器
 * 解析 skills/*\/SKILL.md，提供两级加载策略（轻量目录索引 + 详情按需装载）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SKILLS_DIR = path.resolve(__dirname, '../../skills');

/**
 * 轻量正则解析 Markdown 顶部的 YAML Frontmatter
 * @param {string} content
 * @returns {{ name: string, description: string, version: string, platforms: string[] }}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { name: '', description: '', version: '1.0.0', platforms: [] };
  }

  const rawYaml = match[1];
  const nameMatch = rawYaml.match(/^name:\s*(.+)$/m);
  const descMatch = rawYaml.match(/^description:\s*["']?(.+?)["']?$/m);
  const verMatch = rawYaml.match(/^version:\s*(.+)$/m);
  const platMatch = rawYaml.match(/^platforms:\s*\[(.*?)\]/m);

  let platforms = [];
  if (platMatch && platMatch[1]) {
    platforms = platMatch[1].split(',').map(p => p.trim()).filter(Boolean);
  }

  return {
    name: nameMatch ? nameMatch[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : '',
    version: verMatch ? verMatch[1].trim() : '1.0.0',
    platforms
  };
}

class SkillLoader {
  /**
   * @param {object} [options]
   * @param {string} [options.skillsDir] skills 根目录
   */
  constructor(options = {}) {
    this.skillsDir = options.skillsDir ? path.resolve(options.skillsDir) : DEFAULT_SKILLS_DIR;
    this._catalogCache = null;
    this._detailCache = new Map();
  }

  /**
   * 扫描并获取所有技能的轻量目录列表
   * @param {boolean} [forceRefresh=false]
   * @returns {Array<{ name: string, description: string, version: string, platforms: string[], filePath: string }>}
   */
  getSkillCatalog(forceRefresh = false) {
    if (this._catalogCache && !forceRefresh) {
      return this._catalogCache;
    }

    if (!fs.existsSync(this.skillsDir)) {
      this._catalogCache = [];
      return [];
    }

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    const catalog = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(this.skillsDir, entry.name, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        try {
          const content = fs.readFileSync(skillMdPath, 'utf8');
          const meta = parseFrontmatter(content);
          catalog.push({
            name: meta.name || entry.name,
            description: meta.description || '',
            version: meta.version || '1.0.0',
            platforms: meta.platforms || [],
            filePath: skillMdPath
          });
        } catch (_) {
          // 容错忽略单个损坏的 md
        }
      }
    }

    // 稳定排序
    catalog.sort((a, b) => a.name.localeCompare(b.name));
    this._catalogCache = catalog;
    return catalog;
  }

  /**
   * 格式化轻量级技能目录 Prompt，用于注入 System Prompt (~300 tokens)
   * @returns {string}
   */
  formatCatalogPrompt() {
    const catalog = this.getSkillCatalog();
    if (catalog.length === 0) return '';

    const lines = [
      '### 本地可用技能目录 (按需使用对应工具):'
    ];
    for (const item of catalog) {
      lines.push(`- **${item.name}**: ${item.description}`);
    }
    return lines.join('\n');
  }

  /**
   * 按需加载指定技能的完整 Markdown 内容
   * @param {string} skillName
   * @returns {string|null}
   */
  loadSkillDetail(skillName) {
    if (!skillName || typeof skillName !== 'string') return null;
    const cleanName = skillName.trim().toLowerCase();

    if (this._detailCache.has(cleanName)) {
      return this._detailCache.get(cleanName);
    }

    const catalog = this.getSkillCatalog();
    const target = catalog.find(s => s.name.toLowerCase() === cleanName);
    if (!target || !fs.existsSync(target.filePath)) {
      return null;
    }

    try {
      const fullContent = fs.readFileSync(target.filePath, 'utf8');
      // 剥离 frontmatter，保留主体说明
      const cleanContent = fullContent.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
      this._detailCache.set(cleanName, cleanContent);
      return cleanContent;
    } catch (_) {
      return null;
    }
  }
}

/**
 * 工厂函数
 * @param {object} [options]
 * @returns {SkillLoader}
 */
function createSkillLoader(options = {}) {
  return new SkillLoader(options);
}

module.exports = {
  SkillLoader,
  createSkillLoader,
  parseFrontmatter
};
