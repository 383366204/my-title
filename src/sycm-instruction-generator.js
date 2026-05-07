/**
 * SYCM (生意参谋) 自动化指令生成器
 * 生成 chrome-devtools-mcp 操作指令，用于自动化采集搜索分析数据
 */

/**
 * 获取生意参谋搜索分析页面 URL
 * @param {string} keyword - 搜索关键词
 * @returns {string} 完整的 SYCM URL
 */
function getSycmPageUrl(keyword) {
  return `https://sycm.taobao.com/mc/free/search_analysis?keyWord=${encodeURIComponent(keyword)}`;
}

/**
 * 生成数据提取脚本（在浏览器上下文中通过 evaluate_script 执行）
 * 脚本从生意参谋页面的 DOM 表格中提取 7 列搜索分析数据
 * @returns {string} 可注入浏览器的 JavaScript 脚本字符串
 */
function generateDataExtractionScript() {
  // 自包含脚本，不依赖任何外部变量
  // 使用 Unicode 转义避免编码问题
  const script = `(() => {
  // 列标题映射（Unicode 转义中文避免编码问题）
  const HEADER_MAP = {
    '\\u76f8\\u5173\\u641c\\u7d22\\u8bcd': 'keyword',
    '\\u641c\\u7d22\\u8bcd': 'keyword',
    '\\u641c\\u7d22\\u4eba\\u6c14': 'searchPopularity',
    '\\u70b9\\u51fb\\u7387': 'clickRate',
    '\\u652f\\u4ed8\\u8f6c\\u5316\\u7387': 'conversionRate',
    '\\u652f\\u4ed8\\u4e70\\u5bb6\\u6570': 'buyerCount',
    '\\u9700\\u6c42\\u4f9b\\u7ed9\\u6bd4': 'demandSupplyRatio',
    '\\u5546\\u57ce\\u70b9\\u51fb\\u5360\\u6bd4': 'tmallClickShare',
    '\\u5929\\u732b\\u5546\\u54c1\\u70b9\\u51fb\\u5360\\u6bd4': 'tmallClickShare'
  };

  // 简易数值解析（自包含，不依赖外部函数）
  function parseNum(str) {
    if (!str || typeof str !== 'string') return 0;
    const s = str.trim().replace(/,/g, '');
    // 百分比
    const pct = s.match(/^([\\d.]+)\\s*%$/);
    if (pct) return parseFloat(pct[1]);
    // 区间 "A ~ B"
    const range = s.match(/^([\\d.]+\\s*\\u4e07?)\\s*~+\\s*([\\d.]+\\s*\\u4e07?)$/);
    if (range) {
      const toNum = v => { const m = v.trim().match(/^([\\d.]+)\\s*\\u4e07$/); return m ? parseFloat(m[1]) * 10000 : parseFloat(v) || 0; };
      return (toNum(range[1]) + toNum(range[2])) / 2;
    }
    // 带"万"单值
    const wan = s.match(/^([\\d.]+)\\s*\\u4e07$/);
    if (wan) return parseFloat(wan[1]) * 10000;
    // 纯数字
    return parseFloat(s) || 0;
  }

  // 多表格格式兼容选择器
  const rowSelectors = [
    '.ant-table-tbody tr',
    '.el-table__body-wrapper tbody tr',
    'table tbody tr'
  ];

  let rows = [];
  for (const sel of rowSelectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 0) { rows = Array.from(found); break; }
  }

  if (rows.length === 0) {
    return JSON.stringify({ error: 'no_table_found', rowCount: 0, data: [] });
  }

  // 查找表头映射列索引
  const headerSelectors = [
    '.ant-table-thead th',
    '.el-table__header-wrapper th',
    'table thead th'
  ];

  let headers = [];
  for (const sel of headerSelectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 0) {
      headers = Array.from(found).map(th => th.textContent.trim());
      break;
    }
  }

  // 映射列索引
  const colMap = {};
  headers.forEach((h, i) => {
    const clean = h.replace(/\\s+/g, '');
    for (const [key, mapped] of Object.entries(HEADER_MAP)) {
      if (clean.includes(key) && !colMap[mapped]) {
        colMap[mapped] = i;
        break;
      }
    }
  });

  // 提取数据行
  const results = [];
  rows.forEach(row => {
    const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
    if (cells.length === 0) return;

    const item = {};
    for (const [key, idx] of Object.entries(colMap)) {
      if (key === 'keyword') {
        item[key] = idx < cells.length ? cells[idx] : '';
      } else {
        item[key] = idx < cells.length ? parseNum(cells[idx]) : 0;
      }
    }

    // 关键词不为空才保留
    if (item.keyword && item.keyword.trim() !== '') {
      results.push(item);
    }
  });

  return JSON.stringify({ data: results, rowCount: results.length, source: 'dom' });
})()`;

  return script;
}

/**
 * 生成 SYCM 查询完整指令集（供 chrome-devtools-mcp 执行）
 * @param {string} keyword - 搜索关键词
 * @param {Object} [options={}] - 配置选项
 * @param {number} [options.port=9222] - Chrome 远程调试端口
 * @returns {{chromeRequired: boolean, chromeLaunchCmd: string, targetUrl: string, instructions: Array, extractionScript: string, fallbackHint: string, captchaHint: string}
 */
function generateSycmQueryInstructions(keyword, options = {}) {
  const { port = 9222 } = options;
  const targetUrl = getSycmPageUrl(keyword);
  const extractionScript = generateDataExtractionScript();

  // 引用 sycm-browser-helper 生成 Chrome 启动命令
  let chromeLaunchCmd = '';
  try {
    const { generateChromeLaunchCommand } = require('./sycm-browser-helper');
    chromeLaunchCmd = generateChromeLaunchCommand({ port }).command;
  } catch (e) {
    // sycm-browser-helper 不可用时提供降级命令
    chromeLaunchCmd = `google-chrome --remote-debugging-port=${port} --user-data-dir=/tmp/sycm-chrome-profile --no-first-run`;
  }

  return {
    chromeRequired: true,
    chromeLaunchCmd,
    targetUrl,
    instructions: [
      {
        step: 1,
        tool: 'navigate_page',
        description: '打开生意参谋搜索分析页面',
        args: { url: targetUrl }
      },
      {
        step: 2,
        tool: 'wait_for',
        description: '等待搜索结果数据表格加载（最长30秒）',
        args: { timeout: 30000 }
      },
      {
        step: 3,
        tool: 'evaluate_script',
        description: '提取搜索分析数据（7列：相关搜索词、搜索人气、点击率、支付转化率、支付买家数、需求供给比、天猫点击占比）',
        args: { script: extractionScript }
      }
    ],
    extractionScript,
    fallbackHint: `如果 chrome-devtools-mcp 不可用，请手动操作：\n1. 在 Chrome 中登录淘宝账号\n2. 访问 ${targetUrl}\n3. 等待数据加载\n4. 使用 sycm-extractor 插件提取数据\n5. 数据会自动发送到 POST /api/extract`,
    captchaHint: '如果遇到验证码或滑块，请在浏览器中手动完成验证，然后重新执行步骤3'
  };
}

module.exports = {
  generateSycmQueryInstructions,
  generateDataExtractionScript,
  getSycmPageUrl
};
