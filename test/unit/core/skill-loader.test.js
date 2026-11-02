/**
 * @file skill-loader.test.js
 * @description SkillLoader 单元测试 (ADR D10 索引与两级按需加载)
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  SkillLoader,
  createSkillLoader,
  parseFrontmatter
} = require('../../../core/agent/skill-loader');

describe('SkillLoader Unit Tests', () => {
  let tmpSkillsDir;

  beforeEach(() => {
    tmpSkillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-loader-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpSkillsDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('parseFrontmatter', () => {
    it('should parse standard YAML frontmatter', () => {
      const content = `---
name: test-skill
description: "测试技能描述"
version: 1.2.0
platforms: [macos, linux]
---
# Main Content
This is the skill body.`;

      const meta = parseFrontmatter(content);
      assert.equal(meta.name, 'test-skill');
      assert.equal(meta.description, '测试技能描述');
      assert.equal(meta.version, '1.2.0');
      assert.deepEqual(meta.platforms, ['macos', 'linux']);
    });

    it('should handle missing frontmatter gracefully', () => {
      const content = '# Just Markdown\nNo frontmatter here.';
      const meta = parseFrontmatter(content);
      assert.equal(meta.name, '');
      assert.equal(meta.description, '');
    });
  });

  describe('SkillLoader Catalog and Detail Loading', () => {
    it('should scan directories and discover skills', () => {
      // Create skill A
      const skillADir = path.join(tmpSkillsDir, 'skill-a');
      fs.mkdirSync(skillADir);
      fs.writeFileSync(path.join(skillADir, 'SKILL.md'), `---
name: skill-a
description: Skill A description
version: 1.0.0
---
# Skill A Doc
Full content of skill A.`);

      // Create skill B
      const skillBDir = path.join(tmpSkillsDir, 'skill-b');
      fs.mkdirSync(skillBDir);
      fs.writeFileSync(path.join(skillBDir, 'SKILL.md'), `---
name: skill-b
description: Skill B description
---
# Skill B Doc`);

      const loader = createSkillLoader({ skillsDir: tmpSkillsDir });
      const catalog = loader.getSkillCatalog();

      assert.equal(catalog.length, 2);
      assert.equal(catalog[0].name, 'skill-a');
      assert.equal(catalog[0].description, 'Skill A description');
      assert.equal(catalog[1].name, 'skill-b');

      const prompt = loader.formatCatalogPrompt();
      assert.ok(prompt.includes('**skill-a**: Skill A description'));
      assert.ok(prompt.includes('**skill-b**: Skill B description'));

      const detail = loader.loadSkillDetail('skill-a');
      assert.ok(detail.includes('# Skill A Doc'));
      assert.ok(detail.includes('Full content of skill A.'));
      assert.ok(!detail.includes('---')); // frontmatter stripped
    });

    it('should return null for non-existent skill detail', () => {
      const loader = createSkillLoader({ skillsDir: tmpSkillsDir });
      assert.equal(loader.loadSkillDetail('non-existent'), null);
    });
  });

  describe('Real Skills Directory Verification', () => {
    it('should load actual project skills catalog without crashing', () => {
      const realLoader = createSkillLoader();
      const catalog = realLoader.getSkillCatalog();
      assert.ok(catalog.length >= 5, `Expected at least 5 skills, got ${catalog.length}`);

      const names = catalog.map(s => s.name);
      assert.ok(names.includes('alibaba1688'));
      assert.ok(names.includes('pipeline-flow'));
      assert.ok(names.includes('title-gen'));

      const pipelineDetail = realLoader.loadSkillDetail('pipeline-flow');
      assert.ok(pipelineDetail && pipelineDetail.length > 50);
    });
  });
});
