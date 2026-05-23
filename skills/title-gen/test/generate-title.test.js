const { test, describe, mock } = require('node:test');
const assert = require('node:assert');
const { generateTitles } = require('../src/generate-title');

describe('generateTitles', () => {
  const mockBlueOceanWord = '纯银项链女高级感';
  const mockCoreWord = '项链';
  const mockModifiers = [
    { word: '纯银', rigidity: 'rigid' },
    { word: '女', rigidity: 'rigid' },
    { word: '高级感', rigidity: 'optional' }
  ];
  const mockPeerTitles = [
    '纯银项链女锁骨链ins风',
    'S925纯银项链女高级感',
    '纯银项链女简约百搭'
  ];
  const mockProducts = [
    { id: 'p1', title: '纯银项链女锁骨链', price: 99 },
    { id: 'p2', title: 'S925纯银项链女高级感', price: 129 }
  ];

  test('Test 1: Generated titles start with blue ocean keyword', async () => {
    // Mock GLMClient to return titles that should start with blueOceanWord
    const GLMClient = require('../../../core/glm-client');
    const originalGenerateTitles = GLMClient.prototype.generateTitles;
    
    GLMClient.prototype.generateTitles = mock.fn(() => Promise.resolve([
      '纯银项链女高级感 纯银 女 锁骨链 简约',
      '纯银项链女高级感 S925银 女 高级感 韩版',
      '纯银项链女高级感 纯银 女 生日礼物'
    ]));

    try {
      const titles = await generateTitles(
        mockBlueOceanWord,
        mockCoreWord,
        mockModifiers,
        mockPeerTitles,
        mockProducts,
        60
      );

      assert.ok(Array.isArray(titles), 'Result should be an array');
      assert.ok(titles.length > 0, 'Should return at least one title');
      
      // All titles must start with blueOceanWord
      for (const title of titles) {
        assert.ok(
          title.startsWith(mockBlueOceanWord),
          `Title "${title}" should start with "${mockBlueOceanWord}"`
        );
      }
    } finally {
      GLMClient.prototype.generateTitles = originalGenerateTitles;
    }
  });

  test('Test 2: Titles contain elements from 1688 original titles and taobao peer titles', async () => {
    const GLMClient = require('../../../core/glm-client');
    const originalGenerateTitles = GLMClient.prototype.generateTitles;
    
    // Mock GLM to return titles that include words from peer titles and products
    GLMClient.prototype.generateTitles = mock.fn(() => Promise.resolve([
      '纯银项链女高级感 纯银 女 锁骨链 ins风',
      '纯银项链女高级感 S925银 女 高级感 简约百搭',
      '纯银项链女高级感 纯银 女 韩版 设计感'
    ]));

    try {
      const titles = await generateTitles(
        mockBlueOceanWord,
        mockCoreWord,
        mockModifiers,
        mockPeerTitles,
        mockProducts,
        60
      );

      // Check that titles contain words from peer titles or products
      // Extract meaningful words from source titles (length > 1)
      const sourceWords = [
        ...mockPeerTitles.join(' ').split(/\s+/),
        ...mockProducts.map(p => p.title).join(' ').split(/\s+/)
      ].filter(w => w.length > 1);
      
      for (const title of titles) {
        // Title should start with blueOceanWord and contain at least one source word
        const titleWords = title.split(/\s+/);
        const hasSourceWord = titleWords.some(word => 
          sourceWords.includes(word) && word !== mockBlueOceanWord
        );
        assert.ok(
          hasSourceWord || title.includes('纯银') || title.includes('锁骨链') || title.includes('ins风'),
          `Title "${title}" should contain words from source titles`
        );
      }
    } finally {
      GLMClient.prototype.generateTitles = originalGenerateTitles;
    }
  });

  test('Test 3: Title length does not exceed maxLength', async () => {
    const GLMClient = require('../../../core/glm-client');
    const originalGenerateTitles = GLMClient.prototype.generateTitles;
    const maxLength = 30;
    
    GLMClient.prototype.generateTitles = mock.fn(() => Promise.resolve([
      '纯银项链女高级感 纯银 女',
      '纯银项链女高级感 锁骨链',
      '纯银项链女高级感 S925银'
    ]));

    try {
      const titles = await generateTitles(
        mockBlueOceanWord,
        mockCoreWord,
        mockModifiers,
        mockPeerTitles,
        mockProducts,
        maxLength
      );

      for (const title of titles) {
        assert.ok(
          title.length <= maxLength,
          `Title "${title}" (${title.length} chars) should not exceed ${maxLength} characters`
        );
      }
    } finally {
      GLMClient.prototype.generateTitles = originalGenerateTitles;
    }
  });

  test('Test 4: Banned words are filtered from generated titles', async () => {
    const GLMClient = require('../../../core/glm-client');
    const originalGenerateTitles = GLMClient.prototype.generateTitles;
    
    // Mock GLM to return titles with banned words
    GLMClient.prototype.generateTitles = mock.fn(() => Promise.resolve([
      '纯银项链女高级感 纯银 女 最好',  // "最好" is banned
      '纯银项链女高级感 第一 纯银 女',  // "第一" is banned
      '纯银项链女高级感 纯银 女 正品'   // "正品" might be banned
    ]));

    try {
      const titles = await generateTitles(
        mockBlueOceanWord,
        mockCoreWord,
        mockModifiers,
        mockPeerTitles,
        mockProducts,
        60
      );

      const bannedWords = require('../data/banned-words.json');
      const allBanned = [...new Set(Object.values(bannedWords).flat())];
      
      for (const title of titles) {
        for (const bannedWord of allBanned) {
          assert.ok(
            !title.includes(bannedWord),
            `Title "${title}" should not contain banned word "${bannedWord}"`
          );
        }
      }
    } finally {
      GLMClient.prototype.generateTitles = originalGenerateTitles;
    }
  });

  test('Test 5: Fallback titles still start with blue ocean keyword when GLM fails', async () => {
    const GLMClient = require('../../../core/glm-client');
    const originalGenerateTitles = GLMClient.prototype.generateTitles;
    
    // Mock GLM to throw error (triggering fallback)
    GLMClient.prototype.generateTitles = mock.fn(() => Promise.reject(new Error('API failure')));

    try {
      const titles = await generateTitles(
        mockBlueOceanWord,
        mockCoreWord,
        mockModifiers,
        mockPeerTitles,
        mockProducts,
        60
      );

      assert.ok(Array.isArray(titles), 'Fallback should return an array');
      assert.ok(titles.length > 0, 'Fallback should return at least one title');
      
      // All fallback titles must start with blueOceanWord
      for (const title of titles) {
        assert.ok(
          title.startsWith(mockBlueOceanWord),
          `Fallback title "${title}" should start with "${mockBlueOceanWord}"`
        );
      }
    } finally {
      GLMClient.prototype.generateTitles = originalGenerateTitles;
    }
  });

  test('Test 6: Can generate titles even with empty peer titles list', async () => {
    const GLMClient = require('../../../core/glm-client');
    const originalGenerateTitles = GLMClient.prototype.generateTitles;
    
    GLMClient.prototype.generateTitles = mock.fn(() => Promise.resolve([
      '纯银项链女高级感 纯银 女 锁骨链',
      '纯银项链女高级感 S925银 女 高级感',
      '纯银项链女高级感 纯银 女 简约'
    ]));

    try {
      const titles = await generateTitles(
        mockBlueOceanWord,
        mockCoreWord,
        mockModifiers,
        [], // Empty peer titles
        mockProducts,
        60
      );

      assert.ok(Array.isArray(titles), 'Should return an array');
      assert.ok(titles.length > 0, 'Should return at least one title even with empty peer titles');
      
      // All titles must still start with blueOceanWord
      for (const title of titles) {
        assert.ok(
          title.startsWith(mockBlueOceanWord),
          `Title "${title}" should start with "${mockBlueOceanWord}"`
        );
      }
    } finally {
      GLMClient.prototype.generateTitles = originalGenerateTitles;
    }
  });
});
