/**
 * SYCM CDP 数据提取器
 * 通过 Chrome DevTools Protocol 直接从生意参谋搜索分析页面提取数据
 * 支持：自动导航 → 勾选指标 → 多页遍历 → 结构化返回
 */
var http = require('http');
var WebSocket = require('ws');

var DEFAULT_PORT = 9222;
var DEFAULT_MAX_PAGES = 1;
var PAGE_WAIT_MS = 4000;
var COLUMN_POLL_INTERVAL = 5000;
var COLUMN_POLL_MAX = 8;

var DEFAULT_FILTER_CONDITIONS = {
  demandSupplyRatio: 1,
  searchPopularity: 50,
  conversionRate: 0,
  buyerCount: 0,
  referencePrice: 0
};

var DEFAULT_PAGE_FILTERS = {
  compareType: 'cycle',     // 环比 (cycle) | 年同比 (yearSync)
  timePeriod: '7d'          // 7d | 30d | day | week | month
};

// CLI/MCP 时间周期参数 → SYCM URL 参数映射
var PERIOD_URL_MAP = {
  '7d':   { dateType: 'day' },
  '30d':  { dateType: 'day' },
  'day':  { dateType: 'day' },
  'week': { dateType: 'week' },
  'month':{ dateType: 'month' }
};

// CLI/MCP 环比类型参数 → DOM value 映射
var COMPARE_TYPE_MAP = {
  'cycle': 'cycle',       // 环比
  'yearSync': 'yearSync'  // 年同比
};

var VALID_COMPARE_TYPES = Object.keys(COMPARE_TYPE_MAP);
var VALID_PERIODS = Object.keys(PERIOD_URL_MAP);

function _connectToTab(port, urlFilter) {
  port = port || DEFAULT_PORT;
  return new Promise(function(resolve, reject) {
    http.get('http://127.0.0.1:' + port + '/json/list', function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        var tabs = JSON.parse(body).filter(function(t) {
          return !t.url.includes('g.alicdn.com');
        });
        var tab = urlFilter
          ? tabs.find(function(t) { return t.url.includes(urlFilter); }) || tabs[0]
          : tabs[0];
        if (!tab) return reject(new Error('No Chrome tab found on port ' + port));
        resolve(tab);
      });
    }).on('error', reject);
  });
}

function _createCdpClient(wsUrl) {
  var ws = new WebSocket(wsUrl);
  var msgId = 1;
  var pending = new Map();
  var resolved = false;

  function cleanupPending(errMsg) {
    pending.forEach(function(p, id) {
      clearTimeout(p.timer);
      p.reject(new Error(errMsg));
    });
    pending.clear();
  }

  ws.on('message', function(raw) {
    try {
      var msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        var p = pending.get(msg.id);
        clearTimeout(p.timer);
        pending.delete(msg.id);
        var val = msg.result;
        while (val && val.result) val = val.result;
        p.resolve(val !== undefined ? (val.type ? val.value : val) : msg.result);
      }
    } catch(e) {}
  });

  ws.on('error', function(err) {
    cleanupPending('CDP WebSocket error: ' + (err && err.message || err));
  });

  ws.on('close', function() {
    if (!resolved) cleanupPending('CDP WebSocket closed unexpectedly');
  });

  function evaluate(expr, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    return new Promise(function(resolve, reject) {
      var id = msgId++;
      pending.set(id, {
        resolve: resolve,
        reject: reject,
        timer: setTimeout(function() { pending.delete(id); reject(new Error('CDP eval timeout')); }, timeoutMs)
      });
      ws.send(JSON.stringify({ id: id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    });
  }

  function runAction(expr, timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    return new Promise(function(resolve, reject) {
      var id = msgId++;
      pending.set(id, {
        resolve: resolve,
        reject: reject,
        timer: setTimeout(function() { pending.delete(id); reject(new Error('CDP action timeout')); }, timeoutMs)
      });
      ws.send(JSON.stringify({ id: id, method: 'Runtime.evaluate', params: { expression: expr } }));
    });
  }

  // 连接超时：10秒内未建立则拒绝
  var connectTimeout = setTimeout(function() {
    if (!resolved && ws.readyState === ws.CONNECTING) {
      ws.terminate();
      cleanupPending('CDP connection timeout (10s)');
    }
  }, 10000);

  return new Promise(function(resolve, reject) {
    ws.on('open', function() {
      clearTimeout(connectTimeout);
      resolved = true;
      resolve({ evaluate: evaluate, runAction: runAction, close: function() { cleanupPending('CDP client closed'); ws.close(); } });
    });
    ws.on('error', function(err) {
      clearTimeout(connectTimeout);
      if (!resolved) { resolved = true; reject(new Error('CDP WebSocket error: ' + (err && err.message || err))); }
    });
  });
}

var FILTER_FIELD_SELECTORS = {
  demandSupplyRatio: { label: '需求供给比', selector: null },
  searchPopularity: { label: '搜索人气', selector: null },
  conversionRate: { label: '支付转化率', selector: null },
  buyerCount: { label: '支付买家数', selector: null },
  referencePrice: { label: '关键词推广参考价', selector: null }
};

/**
 * CDP 过滤条件应用
 * @param {object} cdp - CDP client with evaluate/runAction
 * @param {object} filterConditions - { demandSupplyRatio, searchPopularity, ... }
 * @param {function} onProgress - progress callback
 * @returns {Promise<boolean|string>} true=全部应用, 'partial'=部分应用, false=未应用
 */
function _applyFilterConditions(cdp, filterConditions, onProgress) {
  return new Promise(async function(resolve) {
    if (!filterConditions || typeof filterConditions !== 'object') {
      resolve(false);
      return;
    }

    // Step 1: Find and click the filter button
    var btnResult = await cdp.runAction(
      "(() => { " +
      "var trigger = document.querySelector('.op-market-search-blue-ocean-trigger-text'); " +
      "if (trigger) { trigger.click(); return 'clicked:' + (trigger.textContent || '').trim().substring(0, 20); } " +
      "var btns = document.querySelectorAll('button, .ant-btn, [role=\"button\"]'); " +
      "for (var i = 0; i < btns.length; i++) { " +
      "  var text = (btns[i].textContent || '').trim(); " +
      "  if (text.indexOf('设置过滤') >= 0 || text.indexOf('过滤条件') >= 0 || text.indexOf('筛选') >= 0) { " +
      "    btns[i].click(); return 'clicked:' + text.substring(0, 20); " +
      "  } " +
      "} " +
      "return 'not_found'; " +
      "})()",
      10000
    );

    if (String(btnResult).indexOf('not_found') >= 0) {
      onProgress('[WARN] Filter button not found, skipping filter step');
      resolve(false);
      return;
    }

    onProgress('Filter button clicked, waiting for popup...');
    await new Promise(function(r) { setTimeout(r, 2000); });

    // Step 2: Find the modal/popup
    var modalCheck = await cdp.evaluate(
      "document.querySelector('.ant-modal, [role=\"dialog\"]') ? 'found' : 'not_found'",
      5000
    );

    if (String(modalCheck).indexOf('not_found') >= 0) {
      onProgress('[WARN] Filter popup not found after clicking button');
      resolve(false);
      return;
    }

    // Step 3: Fill in filter fields by matching label text
    var appliedFields = 0;
    var totalFields = 0;
    var fieldKeys = Object.keys(filterConditions).filter(function(k) { return filterConditions[k] > 0; });

    for (var fi = 0; fi < fieldKeys.length; fi++) {
      var key = fieldKeys[fi];
      var value = filterConditions[key];
      var fieldConfig = FILTER_FIELD_SELECTORS[key];
      if (!fieldConfig) continue;

      totalFields++;

      // Try to find the input by label text in the modal
      var fillResult = await cdp.runAction(
        "(() => { " +
        "var modal = document.querySelector('.op-market-search-blue-ocean-modal'); " +
        "if (!modal) { modal = document.querySelector('.ant-modal, [role=\"dialog\"]'); } " +
        "if (!modal) return 'no_modal'; " +
        "var rows = modal.querySelectorAll('.op-market-search-blue-ocean-modal-row'); " +
        "if (rows.length === 0) { rows = modal.querySelectorAll('.ant-form-item, .ant-row'); } " +
        "for (var i = 0; i < rows.length; i++) { " +
        "  var label = rows[i].querySelector('.op-market-search-blue-ocean-modal-row-label'); " +
        "  if (!label) { label = rows[i].querySelector('label'); } " +
        "  if (label && label.textContent.indexOf('" + fieldConfig.label + "') >= 0) { " +
        "    var input = rows[i].querySelector('input.ant-input-number-input') || rows[i].querySelector('input'); " +
        "    if (input) { " +
        "      input.focus(); " +
        "      var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; " +
        "      nativeSetter.call(input, '" + String(value) + "'); " +
        "      input.dispatchEvent(new Event('input', { bubbles: true })); " +
        "      input.dispatchEvent(new Event('change', { bubbles: true })); " +
        "      return 'filled:' + label.textContent.trim(); " +
        "    } " +
        "  } " +
        "} " +
        "return 'field_not_found:" + fieldConfig.label + "'; " +
        "})()",
        10000
      );

      if (String(fillResult).indexOf('filled:') >= 0) {
        appliedFields++;
        onProgress('Filter field applied: ' + fieldConfig.label + ' = ' + value);
      } else {
        onProgress('[WARN] Filter field not found: ' + fieldConfig.label);
      }
    }

    // Step 4: Click the confirm/apply button
    var confirmResult = await cdp.runAction(
      "(() => { " +
      "var modal = document.querySelector('.ant-modal, [role=\"dialog\"]'); " +
      "if (!modal) return 'no_modal'; " +
      "var btns = modal.querySelectorAll('button, .ant-btn'); " +
      "for (var i = 0; i < btns.length; i++) { " +
      "  var text = (btns[i].textContent || '').trim().replace(/\\s+/g, ''); " +
      "  if (text === '确定' || text === '应用' || text === '确认') { " +
      "    btns[i].click(); return 'confirmed'; " +
      "  } " +
      "} " +
      "return 'confirm_not_found'; " +
      "})()",
      10000
    );

    if (String(confirmResult).indexOf('confirmed') >= 0) {
      onProgress('Filter confirmed, waiting for data refresh...');
      await new Promise(function(r) { setTimeout(r, 3000); });
    } else {
      onProgress('[WARN] Confirm button not found in filter popup');
    }

    // Step 5: Return result
    if (appliedFields === 0) {
      resolve(false);
    } else if (totalFields > 0 && appliedFields < totalFields) {
      resolve('partial');
    } else {
      resolve(true);
    }
  });
}

function _buildExtractScript() {
  return `(() => {
    var H={'\u76f8\u5173\u641c\u7d22\u8bcd':'keyword','\u641c\u7d22\u8bcd':'keyword','\u641c\u7d22\u4eba\u6c14':'searchPopularity','\u70b9\u51fb\u7387':'clickRate','\u652f\u4ed8\u8f6c\u5316\u7387':'conversionRate','\u652f\u4ed8\u4e70\u5bb6\u6570':'buyerCount','\u9700\u6c42\u4f9b\u7ed9\u6bd4':'demandSupplyRatio','\u5929\u732b\u5546\u54c1\u70b9\u51fb\u5360\u6bd4':'tmallClickShare'};
    function pv(s){if(!s||typeof s!=='string')return{v:0,t:''};var st=s.trim();var tm=st.match(/\s*[+-]?(?:[\d.]+%)?$/);var tr=tm?tm[0].trim():'';if(tr&&tr.length>=st.length)tr='';var vp=tr?st.substring(0,st.length-tr.length).trim():st;var rg=vp.match(/^(.+?)\s*~+\s*(.+)$/);if(rg)return{v:vp,t:tr};var pc=vp.match(/^(\d+(?:\.\d+)?)%$/);if(pc)return{v:parseFloat(pc[1]),t:tr};var wn=vp.match(/^(\d+(?:\.\d+)?)\s*\u4e07$/);if(wn)return{v:Math.round(parseFloat(wn[1])*10000),t:tr};var nm=parseFloat(vp);return{v:isNaN(nm)?vp:nm,t:tr}}
    var tb=document.querySelector('.ant-table-tbody');if(!tb)return JSON.stringify({e:'no_tbody',n:0,d:[]});
    var rows=Array.from(tb.querySelectorAll('tr'));
    var thd=document.querySelector('.ant-table-thead');
    var hdr=thd?Array.from(thd.querySelectorAll('th')).map(function(th){return th.textContent.trim()}):[];
    var cm={};hdr.forEach(function(h,i){var c=h.replace(/\\s+/g,'');for(var k in H){if(c.includes(k)&&!cm[H[k]]){cm[H[k]]=i;break}}});
    var mcc=hdr.length>0?hdr.length-1:5;
    var rs=[];rows.forEach(function(row){var cs=Array.from(row.querySelectorAll('td')).map(function(td){return td.textContent.trim()});if(cs.length<mcc)return;var it={_raw:cs};for(var mk in cm){var ix=cm[mk];if(ix<cs.length){var cv=cs[ix];if(mk==='keyword')it[mk]=cv;else{var p=pv(cv);it[mk]=p.v;it[mk+'_trend']=p.t}}}if(it.keyword&&it.keyword.trim())rs.push(it)});
    return JSON.stringify({d:rs,n:rs.length,h:hdr})
  })()`;
}

/**
 * 根据时间周期计算 SYCM 所需的日期范围字符串
 * @param {string} period - 时间周期: '7d'|'30d'|'day'|'week'|'month'
 * @returns {string} 日期范围字符串，格式 "YYYY-MM-DD|YYYY-MM-DD"
 */
function _computeDateRange(period) {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  var d = String(now.getDate()).padStart(2, '0');

  switch (period) {
    case '7d':
      var weekAgo = new Date(now.getTime() - 7 * 86400000);
      return _formatDate(weekAgo) + '|' + _formatDate(now);
    case '30d':
      var monthAgo = new Date(now.getTime() - 30 * 86400000);
      return _formatDate(monthAgo) + '|' + _formatDate(now);
    case 'day':
      return y + '-' + m + '-' + d + '|' + y + '-' + m + '-' + d;
    case 'week':
      // 本周一到今天
      var dayOfWeek = now.getDay() || 7;
      var monday = new Date(now.getTime() - (dayOfWeek - 1) * 86400000);
      return _formatDate(monday) + '|' + _formatDate(now);
    case 'month':
      // 本月1号到今天
      return y + '-' + m + '-01|' + y + '-' + m + '-' + d;
    default:
      return y + '-' + m + '-' + d + '|' + y + '-' + m + '-' + d;
  }
}

function _formatDate(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

/**
 * 通过 CDP 从生意参谋提取搜索分析数据
 * @param {string} keyword - 搜索关键词
 * @param {Object} [options={}] - 配置选项
 * @param {number} [options.port=9222] - Chrome 调试端口
 * @param {number} [options.maxPages=1] - 最大提取页数
 * @param {string} [options.mode='blue'] - 查询模式: 'hot'=相关热搜词, 'blue'=相关蓝海词
 * @param {Object} [options.pageFilters] - 页面级筛选参数 { compareType: 'cycle'|'yearSync', timePeriod: '7d'|'30d'|'day'|'week'|'month' }
 * @param {Function} [options.onProgress] - 进度回调 fn(stepMsg)
 * @returns {Promise<Object>} 提取结果 { keyword, data[], totalCount, totalPages, currentPage, headers, extractedAt, pageFiltersApplied }
 */
async function extractSycmData(keyword, options) {
  options = options || {};
  var port = options.port || DEFAULT_PORT;
  var maxPages = options.maxPages || DEFAULT_MAX_PAGES;
  var mode = options.mode || 'blue';
  var onProgress = options.onProgress || function() {};
  
  // 页面级筛选参数（环比/年同比 + 时间周期）
  var pageFilters = options.pageFilters || DEFAULT_PAGE_FILTERS;
  var pfCompare = pageFilters.compareType || DEFAULT_PAGE_FILTERS.compareType;
  var pfPeriod = pageFilters.timePeriod || DEFAULT_PAGE_FILTERS.timePeriod;

  if (!keyword) throw new Error('keyword is required');

  onProgress('[CDP] Connecting to Chrome on port ' + port + '...');
  var tab = await _connectToTab(port);
  var cdp = await _createCdpClient(tab.webSocketDebuggerUrl);

  try {
    // 动态构建 URL：时间维度 + 日期范围 + 环比类型
    var periodConfig = PERIOD_URL_MAP[pfPeriod] || PERIOD_URL_MAP['7d'];
    var dateRangeStr = _computeDateRange(pfPeriod);
    var targetUrl = 'https://sycm.taobao.com/mc/free/search_analysis?keyWord='
      + encodeURIComponent(keyword)
      + '&dateType=' + periodConfig.dateType
      + '&dateRange=' + encodeURIComponent(dateRangeStr)
      + '&searchAnalysisRadio=' + pfCompare;
    onProgress('[1/6] Navigating to: ' + keyword + ' (period: ' + pfPeriod + ', compare: ' + pfCompare + ')');
    await cdp.runAction("window.location.href='" + targetUrl.replace(/'/g, "\\'") + "'", 5000);
    cdp.close();
    onProgress('[1/6] Waiting for page load...');
    await new Promise(function(r) { setTimeout(r, 10000); });

    tab = await _connectToTab(port, 'search_analysis');
    cdp = await _createCdpClient(tab.webSocketDebuggerUrl);

    // 先切换到蓝海词模式（如果需要），再勾选指标
    if (mode === 'blue') {
      onProgress('[2/6] Switching to 蓝海词 mode...');
      await cdp.runAction(
        "(() => { var labels = document.querySelectorAll('label.ant-radio-wrapper'); " +
        "for(var i=0;i<labels.length;i++){if(labels[i].textContent.includes('蓝海')){labels[i].click();return 'clicked'}} " +
        "return 'not_found' })()",
        5000
      );
      await new Promise(function(r) { setTimeout(r, 3000); });
    }
    
    // 页面筛选参数已通过 URL 设置，记录应用状态
    var pageFiltersApplied = {
      compareType: pfCompare,
      timePeriod: pfPeriod
    };

    // 勾选全部 6 个指标 checkbox
    onProgress('[3/6] Checking metric checkboxes...');
    await cdp.runAction(
      "(() => { var g=document.querySelector('.ant-checkbox-group.low-Checkbox-v2'); " +
      "if(!g)return'no_group'; " +
      "var ins=g.querySelectorAll('input[type=checkbox]'); " +
      "ins.forEach(function(i){if(!i.checked)i.click()}); " +
      "return'checked:'+ins.length })()",
      10000
    );

    // 等待表格列渲染
    onProgress('[3/6] Waiting for table columns...');
    var colReady = false;
    for (var i = 0; i < COLUMN_POLL_MAX; i++) {
      await new Promise(function(r) { setTimeout(r, COLUMN_POLL_INTERVAL); });
      var hCount = await cdp.evaluate(
        "document.querySelector('.ant-table-thead').querySelectorAll('th').length",
        5000
      );
      if (hCount >= 7) { colReady = true; break; }
    }

    if (!colReady) onProgress('[WARN] Table columns may not be fully loaded');

    // 设置过滤条件（仅蓝海词模式）
    var filterApplied = false;
    if (mode === 'blue' && options.filterConditions) {
      onProgress('[3.5/6] Applying filter conditions...');
      try {
        filterApplied = await _applyFilterConditions(cdp, options.filterConditions, onProgress);
      } catch (filterErr) {
        onProgress('[WARN] Filter step failed: ' + (filterErr.message || filterErr) + ', skipping');
        filterApplied = false;
      }

      if (filterApplied) {
        // 过滤后等待表格重渲染
        await new Promise(function(r) { setTimeout(r, 3000); });
        var reColReady = false;
        for (var fi = 0; fi < 4; fi++) {
          await new Promise(function(r) { setTimeout(r, 3000); });
          var reHCount = await cdp.evaluate(
            "document.querySelector('.ant-table-thead') ? document.querySelector('.ant-table-thead').querySelectorAll('th').length : 0",
            5000
          );
          if (reHCount >= 1) { reColReady = true; break; }
        }
        if (!reColReady) onProgress('[WARN] Table may not have re-rendered after filter');
      }
    }

    // 获取总页数并限制
    onProgress('[4/6] Detecting pagination...');
    var totalInfo = await cdp.evaluate(
      "(() => { var items=document.querySelectorAll('.ant-pagination-item:not(.ant-pagination-disabled)'); " +
      "var nums=[]; items.forEach(function(p){var n=parseInt(p.getAttribute('title')||''); " +
      "if(!isNaN(n)&&n>0)nums.push(n)}); return Math.max.apply(null,nums) })()",
      5000
    );
    var totalPages = Math.min(totalInfo || maxPages, maxPages);

    // 提取第 1 页（含关键词校验，防止 SPA 缓存返回旧数据）
    onProgress('[5/6] Extracting page 1/' + totalPages + '...');
    var result = await cdp.evaluate(_buildExtractScript(), 25000);
    var parsed = (typeof result === 'string') ? JSON.parse(result) : null;
    var allData = parsed ? parsed.d : [];

    // 关键词校验：首条结果必须包含搜索词，否则强制刷新重试一次
    if (allData.length > 0 && keyword) {
      var firstKw = allData[0].keyword || '';
      if (firstKw.indexOf(keyword) < 0) {
        onProgress('[WARN] 首条结果 "' + firstKw + '" 不匹配搜索词 "' + keyword + '"，强制刷新重试...');
        cdp.close();
        tab = await _connectToTab(port, 'search_analysis');
        cdp = await _createCdpClient(tab.webSocketDebuggerUrl);
        // 用 location.replace() 强制完整刷新，绕过 SPA 缓存
        await cdp.runAction("window.location.replace('" + targetUrl.replace(/'/g, "\\'") + "')", 5000);
        cdp.close();
        await new Promise(function(r) { setTimeout(r, 12000); });
        tab = await _connectToTab(port, 'search_analysis');
        cdp = await _createCdpClient(tab.webSocketDebuggerUrl);
        // 蓝海词模式需要重新切换
        if (mode === 'blue') {
          await cdp.runAction(
            "(() => { var labels = document.querySelectorAll('label.ant-radio-wrapper'); " +
            "for(var i=0;i<labels.length;i++){if(labels[i].textContent.includes('蓝海')){labels[i].click();return 'clicked'}} " +
            "return 'not_found' })()",
            5000
          );
          await new Promise(function(r) { setTimeout(r, 3000); });
        }
        // 勾选指标
        await cdp.runAction(
          "(() => { var g=document.querySelector('.ant-checkbox-group.low-Checkbox-v2'); " +
          "if(!g)return'no_group'; " +
          "var ins=g.querySelectorAll('input[type=checkbox]'); " +
          "ins.forEach(function(i){if(!i.checked)i.click()}); " +
          "return'checked:'+ins.length })()",
          10000
        );
        await new Promise(function(r) { setTimeout(r, COLUMN_POLL_INTERVAL); });
        // 重新提取
        result = await cdp.evaluate(_buildExtractScript(), 25000);
        parsed = (typeof result === 'string') ? JSON.parse(result) : null;
        allData = parsed ? parsed.d : [];
        if (allData.length > 0) {
          onProgress('[OK] 重试后首条结果: ' + (allData[0].keyword || '(empty)'));
        }
      }
    }

    // 遍历剩余页面
    onProgress('[6/6] Traversing pages 2-' + totalPages + '...');
    for (var page = 2; page <= totalPages; page++) {
      var navResult = await cdp.runAction(
        "(() => { var btn=document.querySelector('.ant-pagination-next'); " +
        "if(btn&&!btn.classList.contains('ant-pagination-disabled')){btn.click();return'clicked'} " +
        "return'disabled:'+(!!btn) })()",
        10000
      );

      if (String(navResult).indexOf('disabled:') >= 0) break;

      await new Promise(function(r) { setTimeout(r, PAGE_WAIT_MS); });

      var pr = await cdp.evaluate(_buildExtractScript(), 25000);
      var pd = (typeof pr === 'string') ? JSON.parse(pr) : null;

      if (pd && pd.d && pd.d.length > 0) {
        var lastKw = allData.length > 0 ? allData[allData.length - 1].keyword : '';
        var dedupedPage = pd.d;
        while (dedupedPage.length > 0 && lastKw && dedupedPage[0].keyword === lastKw) {
          dedupedPage = dedupedPage.slice(1);
        }
        if (dedupedPage.length > 0) {
          allData = allData.concat(dedupedPage);
          onProgress('  Page ' + page + ': ' + pd.n + ' rows (total: ' + allData.length + ')');
        } else {
          onProgress('  Page ' + page + ': all duplicates, skipped');
        }
        onProgress('  Page ' + page + ': ' + pd.n + ' rows (total: ' + allData.length + ')');
      }
    }

    // 清理 _raw 字段，构建返回值
    var cleanData = allData.map(function(r) {
      var obj = {};
      Object.keys(r).forEach(function(k) { if (k !== '_raw') obj[k] = r[k]; });
      return obj;
    });

    return {
      keyword: keyword,
      source: 'sycm_search_analysis',
      extractedAt: new Date().toISOString(),
      method: 'cdp_multi_page',
      mode: mode,
      filterApplied: filterApplied,
      pageFiltersApplied: pageFiltersApplied,
      maxPages: maxPages,
      totalPages: totalPages,
      currentPage: 1,
      headers: parsed ? parsed.h : [],
      totalCount: cleanData.length,
      data: cleanData
    };
  } finally {
    cdp.close();
  }
}

module.exports = {
  extractSycmData: extractSycmData,
  DEFAULT_PORT: DEFAULT_PORT,
  DEFAULT_MAX_PAGES: DEFAULT_MAX_PAGES,
  DEFAULT_FILTER_CONDITIONS: DEFAULT_FILTER_CONDITIONS,
  FILTER_FIELD_SELECTORS: FILTER_FIELD_SELECTORS,
  DEFAULT_PAGE_FILTERS: DEFAULT_PAGE_FILTERS,
  PERIOD_URL_MAP: PERIOD_URL_MAP,
  COMPARE_TYPE_MAP: COMPARE_TYPE_MAP,
  VALID_COMPARE_TYPES: VALID_COMPARE_TYPES,
  VALID_PERIODS: VALID_PERIODS
};
