const axios = require('axios');

class GLMClient {
  /**
   * 构造函数
   * @param {object} config - 配置
   * @param {string} config.apiKey - GLM API Key
   * @param {string} [config.apiBase] - API 基础地址
   * @param {string} [config.model] - 模型名称
   */
  constructor(config) {
    this.apiKey = config.apiKey;
    this.apiBase = config.apiBase || 'https://open.bigmodel.cn/api/paas/v4';
    this.model = config.model || 'glm-4-flash';
  }

  /**
   * 提取核心词和带刚性分类的修饰词
   * @param {string} input - 用户输入关键词
   * @returns {Promise<{
   *   coreWord: string,
   *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>
   * }>} 
   */
  async extractCoreAndModifiers(input) {
    const systemPrompt = `你是一个电商标题分析助手。请从用户关键词中提取：

1. 核心商品词 - 1-2个词，代表商品类别（如项链、裙子）
2. 修饰词列表 - 每个修饰词标注刚性程度：
   - "rigid" = 强制匹配（不满足则产品错误，必须剔除）
   - "optional" = 可选匹配（只用于描述吸引力，不强制）

判断规则：
- 材质 → rigid（如"纯银"必须是纯银材质）
- 颜色 → rigid（如"黑色"必须是黑色）
- 规格尺寸 → rigid（如"XL"必须是XL）
- 目标人群 → rigid（如"女款"必须是女款）
- 风格 → optional（如"ins风"是风格描述，不强制）
- 流行词 → optional（如"高级感"、"网红"是描述性词，不强制）
- 时间/季节 → optional（如"2026新款"、"夏季"不强制）

输出严格 JSON 格式，不要任何其他文字：
{
  "coreWord": "核心词",
  "modifiers": [
    {"word": "修饰词1", "rigidity": "rigid"},
    {"word": "修饰词2", "rigidity": "optional"}
  ]
}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input }
    ];

    const response = await axios.post(
      `${this.apiBase}/chat/completions`,
      {
        model: this.model,
        messages,
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    let content = response.data.choices[0].message.content.trim();
    // 移除可能的 markdown 代码块
    content = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const result = JSON.parse(content);

    // 验证格式
    if (!result.coreWord || !Array.isArray(result.modifiers)) {
      throw new Error('Invalid response format from GLM');
    }

    result.modifiers.forEach(mod => {
      if (!['rigid', 'optional'].includes(mod.rigidity)) {
        mod.rigidity = 'optional';
      }
    });

    return result;
  }
}

module.exports = GLMClient;
