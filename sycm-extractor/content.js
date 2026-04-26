// content.js — 在隔离世界中接收 XHR 数据，映射字段，格式化为 Tab 分隔文本

(function() {
  'use strict';
  
  console.log('[SYCM-CONTENT] 生意参谋数据提取脚本已加载 (isolated world)');
  
  // 标准 7 列顺序（与 parseSycmData 一致）
  const COLUMNS = [
    { key: 'keyword', header: '相关搜索词' },
    { key: 'searchPopularity', header: '搜索人气' },
    { key: 'clickRate', header: '点击率' },
    { key: 'conversionRate', header: '支付转化率' },
    { key: 'buyerCount', header: '支付买家数' },
    { key: 'demandSupplyRatio', header: '需求供给比' },
    { key: 'tmallClickShare', header: '天猫商品点击占比' }
  ];
  
  const HEADER_ROW = COLUMNS.map(c => c.header).join('\t');
  
  // 缓存的 XHR 数据
  let cachedApiData = null;
  let lastExtractTime = null;
  
  // 页面检测
  function isSycmPage() {
    const host = window.location.hostname;
    return host.includes('sycm.taobao.com');
  }
  
  // 监听 XHR 数据
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'sycm-api-data') {
      console.log('[SYCM-CONTENT] 收到 API 数据:', event.data.url);
      cachedApiData = event.data;
      lastExtractTime = Date.now();
    }
  });
  
  // 从 API JSON 中提取关键词数据
  // 需要适配不同平台的 API 响应格式
  function extractKeywordsFromApi(apiData) {
    if (!apiData || !apiData.data) {
      console.log('[SYCM-CONTENT] API 数据为空');
      return [];
    }
    
    const rawData = apiData.data;
    let keywords = [];
    
    // 尝试多种常见的 API 响应结构
    
    // 路径1: data.resultList 或 data.data
    const resultList = rawData.resultList || rawData.data || rawData.list || rawData.result || rawData.items || [];
    
    if (Array.isArray(resultList)) {
      keywords = resultList;
    } else if (resultList && typeof resultList === 'object') {
      // 可能是嵌套结构，如 data.resultList.data
      const nestedArray = Object.values(resultList).find(val => Array.isArray(val));
      if (nestedArray) {
        keywords = nestedArray;
      } else if (Array.isArray(resultList.data)) {
        keywords = resultList.data;
      } else if (Array.isArray(resultList.list)) {
        keywords = resultList.list;
      } else if (Array.isArray(resultList.result)) {
        keywords = resultList.result;
      } else if (Array.isArray(resultList.items)) {
        keywords = resultList.items;
      }
    }
    
    // 如果还没找到，尝试直接提取 data 中的数组
    if (keywords.length === 0 && typeof rawData === 'object') {
      const allArrays = Object.values(rawData).filter(val => Array.isArray(val));
      if (allArrays.length > 0) {
        // 选择最长的数组作为关键词列表
        keywords = allArrays.reduce((longest, arr) => arr.length > longest.length ? arr : longest, []);
      }
    }
    
    // 过滤无效数据
    keywords = keywords.filter(item => {
      if (!item || typeof item !== 'object') return false;
      
      // 至少应该有关键词字段
      const hasKeyword = item.keyword || item.searchWord || item.word || item['相关搜索词'] || item.name || item.title;
      return !!hasKeyword;
    });
    
    console.log(`[SYCM-CONTENT] 提取到 ${keywords.length} 个关键词`);
    return keywords;
  }
  
  // 将 API 关键词映射到标准 7 列
  // API 中的字段名可能不同，需要做映射
  function mapKeywordToRow(item) {
    if (!item || typeof item !== 'object') {
      return COLUMNS.map(() => '').join('\t');
    }
    
    // 字段名映射（不同平台可能用不同名称）
    const fieldMap = {
      // 关键词字段
      keyword: item.keyword || item.searchWord || item.word || item['相关搜索词'] || item.name || item.title || '',
      
      // 搜索人气字段
      searchPopularity: item.searchPopularity || item.searchNum || item.searchCount || 
                       item.searchIndex || item.popularity || item['搜索人气'] || 
                       item.search_uv || item.uv || '',
      
      // 点击率字段
      clickRate: item.clickRate || item.ctr || item.clickRateRatio || item.click_ratio || 
                item.clickIndex || item['点击率'] || item.ctr_ratio || '',
      
      // 支付转化率字段
      conversionRate: item.conversionRate || item.payRate || item.conversionRatio || 
                     item.payConversionRate || item.pay_ratio || item['支付转化率'] || 
                     item.conversion_ratio || '',
      
      // 支付买家数字段
      buyerCount: item.buyerCount || item.payBuyerCnt || item.payBuyerCount || 
                 item.buyerCnt || item.pay_buyer_cnt || item['支付买家数'] || 
                 item.buyer_count || '',
      
      // 需求供给比字段
      demandSupplyRatio: item.demandSupplyRatio || item.sdr || item.supplyDemandRatio || 
                        item.demand_supply_ratio || item['需求供给比'] || 
                        item.supply_demand_ratio || item.dsr || '',
      
      // 天猫商品点击占比字段
      tmallClickShare: item.tmallClickShare || item.mallCpro || item.tmallClickPro || 
                      item.tmall_click_share || item['天猫商品点击占比'] || 
                      item.mall_click_pro || item.tmall_pro || ''
    };
    
    // 转换为字符串，保持原始格式
    const rowValues = COLUMNS.map(col => {
      const value = fieldMap[col.key];
      
      if (value === null || value === undefined || value === '') {
        return '';
      }
      
      // 如果是数字，转为字符串但不做格式化（保持原始值）
      if (typeof value === 'number') {
        return value.toString();
      }
      
      // 如果是字符串，直接返回
      if (typeof value === 'string') {
        return value.trim();
      }
      
      // 其他类型转为字符串
      return String(value);
    });
    
    return rowValues.join('\t');
  }
  
  // 格式化为 Tab 分隔文本
  function formatAsTSV(keywords) {
    if (!keywords || keywords.length === 0) {
      return '';
    }
    
    const rows = [HEADER_ROW];
    let validRowCount = 0;
    
    for (const item of keywords) {
      const row = mapKeywordToRow(item);
      
      // 检查行是否有效（不是所有列都为空）
      const cells = row.split('\t');
      const isEmptyRow = cells.every(cell => cell === '' || cell === null || cell === undefined);
      
      if (!isEmptyRow) {
        rows.push(row);
        validRowCount++;
      }
    }
    
    console.log(`[SYCM-CONTENT] 生成 ${validRowCount} 行有效数据`);
    return rows.join('\n');
  }
  
  // DOM 表头映射
  const HEADER_KEYWORD_MAP = {
    '相关搜索词': 'keyword',
    '搜索词': 'keyword', 
    '搜索人气': 'searchPopularity',
    '点击率': 'clickRate',
    '支付转化率': 'conversionRate',
    '支付买家数': 'buyerCount',
    '需求供给比': 'demandSupplyRatio',
    '天猫商品点击占比': 'tmallClickShare',
    '商城点击占比': 'tmallClickShare'
  };
  
  // 从 DOM 表格提取数据（fallback 方案）
  function extractFromDOM() {
    console.log('[SYCM-CONTENT] 尝试从 DOM 提取数据');
    
    // 收集所有可能的表格容器
    let tables = [];
    
    // 查找原生 table
    const nativeTables = document.querySelectorAll('table');
    nativeTables.forEach(table => tables.push(table));
    
    // 查找 Element Plus 表格（el-table）
    const elTables = document.querySelectorAll('.el-table');
    elTables.forEach(table => tables.push(table));
    
    // 查找其他常见表格类名
    const commonTables = document.querySelectorAll('[class*="table"], [class*="grid"]');
    commonTables.forEach(table => tables.push(table));
    
    console.log(`[SYCM-CONTENT] 找到 ${tables.length} 个候选表格/容器`);
    
    if (tables.length === 0) {
      console.log('[SYCM-CONTENT] 没有找到任何表格元素');
      return {
        success: false,
        error: 'no_table_found',
        message: '页面中未找到表格，请确保在生意参谋搜索结果页面'
      };
    }
    
    // 诊断信息：输出所有找到的表格类名
    const tableInfo = tables.map((t, index) => ({
      index,
      tagName: t.tagName,
      className: t.className
    }));
    console.log('[SYCM-CONTENT] 表格候选列表:', tableInfo);
    
    // 优先找包含目标表头的表格
    let targetTable = null;
    
    for (const table of tables) {
      const text = table.textContent || '';
      if (text.includes('相关搜索词') || text.includes('搜索词')) {
        targetTable = table;
        break;
      }
    }
    
    // 如果没找到，选第一个非空表格
    if (!targetTable && tables.length > 0) {
      targetTable = tables[0];
    }
    
    if (!targetTable) {
      return {
        success: false,
        error: 'no_target_table',
        message: '未找到包含搜索词数据的表格'
      };
    }
    
    // 提取表头和数据行
    let rows = [];
    
    // 处理原生 table
    if (targetTable.tagName === 'TABLE') {
      rows = Array.from(targetTable.querySelectorAll('tr'));
    } else {
      // 处理 div 表格（如 el-table）
      const headerRow = targetTable.querySelector('.el-table__header-wrapper tr');
      const bodyRows = targetTable.querySelectorAll('.el-table__body-wrapper tr');
      
      if (headerRow) {
        rows.push(headerRow);
      }
      bodyRows.forEach(row => rows.push(row));
    }
    
    if (rows.length <= 1) {
      // 只有表头没有数据
      return {
        success: false,
        error: 'no_data_rows',
        message: '表格中没有数据行，请确保搜索后已有数据显示'
      };
    }
    
    // 提取表头
    const headerRow = rows[0];
    let headers = [];
    
    if (headerRow.tagName === 'TR') {
      headers = Array.from(headerRow.querySelectorAll('th, td')).map(th => th.textContent.trim());
    } else {
      headers = [headerRow.textContent.trim()];
    }
    
    console.log(`[SYCM-CONTENT] 提取到表头: [${headers.join(', ')}]`);
    
    // 映射表头列索引
    const columnMap = {};
    let mappedCount = 0;
    
    headers.forEach((headerText, index) => {
      // 清除空白字符
      const cleanHeader = headerText.replace(/\s+/g, '').trim();
      
      // 查找匹配
      for (const [key, mappedKey] of Object.entries(HEADER_KEYWORD_MAP)) {
        const cleanKey = key.replace(/\s+/g, '').trim();
        if (cleanHeader.includes(cleanKey) || cleanKey.includes(cleanHeader)) {
          if (!columnMap[mappedKey]) {
            columnMap[mappedKey] = index;
            mappedCount++;
            break;
          }
        }
      }
    });
    
    console.log(`[SYCM-CONTENT] 成功映射 ${mappedCount} 列`);
    
    // 检查列数
    if (mappedCount < 7) {
      return {
        success: false,
        error: 'insufficient_columns',
        message: `页面只显示了 ${mappedCount} 列数据，建议在生意参谋中勾选所有 7 个指标列以获得完整数据`,
        foundColumns: mappedCount,
        requiredColumns: 7
      };
    }
    
    // 提取数据行
    const keywords = [];
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      let cells = [];
      
      if (row.tagName === 'TR') {
        cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
      }
      
      if (cells.length === 0) {
        continue;
      }
      
      // 映射到标准字段
      const keywordItem = {};
      
      for (const [key, colIndex] of Object.entries(columnMap)) {
        if (colIndex < cells.length) {
          keywordItem[key] = cells[colIndex];
        }
      }
      
      // 至少有关键词
      if (keywordItem.keyword && keywordItem.keyword.trim() !== '') {
        keywords.push(keywordItem);
      }
    }
    
    console.log(`[SYCM-CONTENT] 从 DOM 提取到 ${keywords.length} 个关键词`);
    
    if (keywords.length === 0) {
      return {
        success: false,
        error: 'no_keywords_found',
        message: '从表格中未提取到有效关键词数据'
      };
    }
    
    return {
      success: true,
      keywords: keywords
    };
  }
  
  // 提取数据主函数
  function extractData() {
    if (!isSycmPage()) {
      console.log('[SYCM-CONTENT] 当前页面不是生意参谋');
      return { 
        error: 'not_sycm_page',
        message: '请在生意参谋页面 (sycm.taobao.com) 使用此功能'
      };
    }
    
    let keywords = null;
    let source = null;
    let apiUrl = null;
    
    // 优先使用 XHR 拦截的数据
    if (cachedApiData) {
      // 检查数据是否过期（10分钟）
      const DATA_EXPIRY_MS = 10 * 60 * 1000; // 10分钟
      if (lastExtractTime && (Date.now() - lastExtractTime) <= DATA_EXPIRY_MS) {
        keywords = extractKeywordsFromApi(cachedApiData);
        if (keywords && keywords.length > 0) {
          source = cachedApiData.source || 'xhr';
          apiUrl = cachedApiData.url;
          console.log(`[SYCM-CONTENT] 使用 XHR 数据，提取到 ${keywords.length} 个关键词`);
        }
      }
    }
    
    // 如果 XHR 没有数据，尝试 DOM 提取 fallback
    if (!keywords || keywords.length === 0) {
      console.log('[SYCM-CONTENT] XHR 无有效数据，尝试 DOM 提取 fallback');
      
      const domResult = extractFromDOM();
      if (!domResult.success) {
        console.log('[SYCM-CONTENT] DOM 提取失败:', domResult.error);
        return { 
          error: domResult.error, 
          message: domResult.message,
          hint: 'XHR 拦截失败且 DOM 提取也失败，请刷新页面重新搜索后再试'
        };
      }
      
      keywords = domResult.keywords;
      source = 'dom';
    }
    
    // 再次检查是否有数据
    if (!keywords || keywords.length === 0) {
      console.log('[SYCM-CONTENT] 没有找到关键词数据（XHR + DOM 都失败）');
      return { 
        error: 'no_data_available', 
        message: 'XHR 未拦截到数据且 DOM 提取也未找到关键词',
        hint: '请先在页面搜索关键词，等待数据加载后再提取'
      };
    }
    
    const tsv = formatAsTSV(keywords);
    if (!tsv || tsv === HEADER_ROW + '\n') {
      console.log('[SYCM-CONTENT] 格式化后没有有效数据');
      return { 
        error: 'no_valid_data', 
        message: '数据格式化后没有有效内容',
        hint: '请检查数据是否正确加载'
      };
    }
    
    console.log(`[SYCM-CONTENT] 成功提取 ${keywords.length} 个关键词，来源: ${source}`);
    return { 
      success: true,
      data: tsv, 
      rowCount: keywords.length,
      source: source,
      apiUrl: apiUrl,
      timestamp: new Date().toISOString()
    };
  }
  
  // 复制到剪贴板的辅助函数
  function copyToClipboard(text) {
    return new Promise((resolve, reject) => {
      // 现代 clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(() => resolve({ success: true, method: 'modern' }))
          .catch(err => {
            console.warn('[SYCM-CONTENT] 现代剪贴板 API 失败，使用备用方法:', err);
            // 回退到 textarea 方法
            copyViaTextarea(text, resolve, reject);
          });
      } else {
        // 直接使用 textarea 方法
        copyViaTextarea(text, resolve, reject);
      }
    });
  }
  
  function copyViaTextarea(text, resolve, reject) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      
      document.body.appendChild(textarea);
      textarea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      
      if (successful) {
        resolve({ success: true, method: 'fallback' });
      } else {
        reject(new Error('execCommand copy failed'));
      }
    } catch (err) {
      reject(err);
    }
  }
  
  // 监听来自 popup 的消息
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log('[SYCM-CONTENT] 收到消息:', msg.action);
    
    if (msg.action === 'extract') {
      const result = extractData();
      sendResponse(result);
      return true; // 保持消息通道开启（异步响应）
    }
    
    if (msg.action === 'copy') {
      const result = extractData();
      
      if (result.error) {
        sendResponse(result);
        return true;
      }
      
      // 复制到剪贴板
      copyToClipboard(result.data)
        .then(copyResult => {
          sendResponse({ 
            success: true, 
            rowCount: result.rowCount,
            copyMethod: copyResult.method,
            timestamp: result.timestamp
          });
        })
        .catch(copyError => {
          console.error('[SYCM-CONTENT] 复制失败:', copyError);
          sendResponse({ 
            error: 'copy_failed', 
            message: '复制到剪贴板失败',
            details: copyError.message
          });
        });
      
      return true; // 保持消息通道开启（异步响应）
    }
    
    if (msg.action === 'ping') {
      // 健康检查
      sendResponse({ 
        status: 'ok', 
        isSycmPage: isSycmPage(),
        hasData: !!cachedApiData,
        dataAge: lastExtractTime ? Date.now() - lastExtractTime : null
      });
      return true;
    }
    
    if (msg.action === 'get-data-sample') {
      // 返回数据样本用于调试
      const result = extractData();
      if (result.success) {
        // 只返回前几行作为样本
        const lines = result.data.split('\n');
        const sampleLines = lines.slice(0, Math.min(5, lines.length));
        result.dataSample = sampleLines.join('\n');
        delete result.data; // 移除完整数据以节省空间
      }
      sendResponse(result);
      return true;
    }
    
    // 未知操作
    sendResponse({ error: 'unknown_action', action: msg.action });
    return false;
  });
  
  // 初始化检查
  console.log('[SYCM-CONTENT] 脚本初始化完成');
  console.log('[SYCM-CONTENT] 当前页面:', window.location.href);
  console.log('[SYCM-CONTENT] 是否为生意参谋页面:', isSycmPage());
})();