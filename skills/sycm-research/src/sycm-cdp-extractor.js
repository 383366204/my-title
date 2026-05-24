/**
 * SYCM CDP 数据提取器
 * 通过 Chrome DevTools Protocol 直接从生意参谋搜索分析页面提取数据
 * 支持：自动导航 → 勾选指标 → 多页遍历 → 结构化返回
 */
var http = require('http');
var path = require('path');
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

function _getManualLoginProfileDir(options) {
  options = options || {};
  return options.chromeProfileDir ||
    process.env.SYCM_CHROME_PROFILE_DIR ||
    path.join(process.env.USERPROFILE || process.env.HOME || '/tmp', 'AppData', 'Local', 'ecom-ai-tools-chrome');
}

function _createLoginRequiredError(options) {
  var err = new Error('生意参谋登录态已失效，请人工登录后重试');
  err.code = 'SYCM_LOGIN_REQUIRED';
  err.status = 'login_required';
  err.loginUrl = 'https://sycm.taobao.com/custom/login.htm';
  err.profileDir = _getManualLoginProfileDir(options);
  err.details = {
    ok: false,
    status: err.status,
    message: err.message,
    loginUrl: err.loginUrl,
    profileDir: err.profileDir
  };
  return err;
}

async function _hasLoginIframe(cdp) {
  try {
    var tree = await cdp.sendCommand('Page.getFrameTree', {});
    var found = false;
    function walk(node) {
      if (!node || !node.frame) return;
      var name = node.frame.name || '';
      var url = node.frame.url || '';
      if (name === 'alibaba-login-box' || url.includes('havanalogin.taobao.com') || url.includes('login.taobao.com')) {
        found = true;
      }
      (node.childFrames || []).forEach(walk);
    }
    walk(tree.frameTree);
    return found;
  } catch (e) {
    return false;
  }
}

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

  function sendCommand(method, params, timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    return new Promise(function(resolve, reject) {
      var id = msgId++;
      pending.set(id, {
        resolve: resolve,
        reject: reject,
        timer: setTimeout(function() { pending.delete(id); reject(new Error('CDP command timeout: ' + method)); }, timeoutMs)
      });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  }

  function evaluateInFrame(frameName, expr, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    return new Promise(async function(resolve, reject) {
      try {
        // Enable Page domain if not already enabled
        await sendCommand('Page.enable', {}, timeoutMs);
        // Get frame tree
        var tree = await sendCommand('Page.getFrameTree', {}, timeoutMs);
        var children = tree.frameTree.childFrames || [];
        var frame = children.find(function(f) { return f.frame.name === frameName; });
        if (!frame) {
          reject(new Error('Frame not found: ' + frameName));
          return;
        }
        var frameId = frame.frame.id;
        // Create isolated world for the frame
        var world = await sendCommand('Page.createIsolatedWorld', {
          frameId: frameId,
          worldName: 'sycm-login-' + Date.now()
        }, timeoutMs);
        var contextId = world.executionContextId;
        if (!contextId) {
          reject(new Error('Failed to create isolated world'));
          return;
        }
        // Evaluate expression in that context
        var result = await sendCommand('Runtime.evaluate', {
          expression: expr,
          contextId: contextId,
          returnByValue: true
        }, timeoutMs);
        resolve(result);
      } catch (err) {
        reject(err);
      }
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
      resolve({
        evaluate: evaluate,
        runAction: runAction,
        sendCommand: sendCommand,
        evaluateInFrame: evaluateInFrame,
        dispatchMouseEvent: function(type, x, y, opts) {
          opts = opts || {};
          return sendCommand('Input.dispatchMouseEvent', {
            type: type, x: x, y: y,
            button: opts.button || 'left',
            clickCount: opts.clickCount || 1
          });
        },
        captureScreenshot: function(format) {
          return sendCommand('Page.captureScreenshot', { format: format || 'png' });
        },
        close: function() { cleanupPending('CDP client closed'); ws.close(); }
      });
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
    var H={'\u76f8\u5173\u641c\u7d22\u8bcd':'keyword','\u641c\u7d22\u8bcd':'keyword','\u641c\u7d22\u4eba\u6c14':'searchPopularity','\u70b9\u51fb\u7387':'clickRate','\u652f\u4ed8\u8f6c\u5316\u7387':'conversionRate','\u652f\u4ed8\u4e70\u5bb6\u6570':'buyerCount','\u9700\u6c42\u4f9b\u7ed9\u6bd4':'demandSupplyRatio','\u9700\u6c42\u4f9b\u7ed9\u6bd4\u503c':'demandSupplyRatio','\u5929\u732b\u5546\u54c1\u70b9\u51fb\u5360\u6bd4':'tmallClickShare'};
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
 * @param {string} [options.loginMode='manual'] - 登录模式，目前仅支持 manual（复用人工登录态）
 * @param {string} [options.chromeProfileDir] - Chrome 登录态目录，默认读取 SYCM_CHROME_PROFILE_DIR
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
  await cdp.sendCommand('Page.enable', {});

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

    tab = await _connectToTab(port);
    cdp = await _createCdpClient(tab.webSocketDebuggerUrl);
    await cdp.sendCommand('Page.enable', {});
    var currentUrl = await cdp.evaluate("window.location.href", 5000);

    if (currentUrl.includes('login.taobao.com') ||
        currentUrl.includes('passport.taobao.com') ||
        currentUrl.includes('sycm.taobao.com/custom/login') ||
        await _hasLoginIframe(cdp)) {
      onProgress('[AUTH] 检测到 SYCM 未登录或登录态失效，请人工登录后重试');
      throw _createLoginRequiredError(options);
    } else {
      cdp.close();
    }

    tab = await _connectToTab(port, 'search_analysis');
    cdp = await _createCdpClient(tab.webSocketDebuggerUrl);
    await cdp.sendCommand('Page.enable', {});

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

    var categoryAnalysis = null;
    try {
      onProgress('[6.5/7] Extracting category analysis...');
      var catData = await _extractCategoryAnalysis(cdp);
      if (catData && catData.rows && catData.rows.length > 0) {
        var categoryRecommendation = _recommendCategory(catData);
        categoryAnalysis = {
          data: catData,
          recommendation: categoryRecommendation
        };
        onProgress('[6.5/7] Category: ' + (categoryRecommendation.recommended ? categoryRecommendation.recommended.category : 'none'));
      }
    } catch (catErr) {
      onProgress('[WARN] Category analysis failed: ' + (catErr.message || catErr));
    }

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
      data: cleanData,
      categoryAnalysis: categoryAnalysis,
      qrCode: null
    };
  } finally {
    cdp.close();
  }
}

/**
 * 通过 CDP 物理点击切换到扫码登录模式
 * 注意：必须点 i.icon-qrcode（非外层div），且用 Input.dispatchMouseEvent（el.click对React无效）
 * @param {object} cdp - CDP client
 * @returns {Promise<boolean>}
 */
async function _switchToQrMode(cdp) {
  try {
    var iframeRect = await cdp.evaluate(
      "(function(){var f=document.getElementById('alibaba-login-box');var r=f.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()"
    );
    var iconRect = await cdp.evaluateInFrame('alibaba-login-box',
      "(function(){var el=document.querySelector('i.icon-qrcode');if(!el)return{found:false};var r=el.getBoundingClientRect();return{found:true,x:r.x,y:r.y,w:r.width,h:r.height}})()"
    );
    if (!iconRect || !iconRect.found) return false;

    var clickX = Math.round(iframeRect.x + iconRect.x + iconRect.w / 2);
    var clickY = Math.round(iframeRect.y + iconRect.y + iconRect.h / 2);

    await cdp.dispatchMouseEvent('mouseMoved', clickX, clickY);
    await new Promise(function(r) { setTimeout(r, 200); });
    await cdp.dispatchMouseEvent('mousePressed', clickX, clickY, { button: 'left', clickCount: 1 });
    await cdp.dispatchMouseEvent('mouseReleased', clickX, clickY, { button: 'left', clickCount: 1 });

    await new Promise(function(r) { setTimeout(r, 3000); });

    var state = await cdp.evaluateInFrame('alibaba-login-box',
      "(function(){var c=document.querySelector('canvas');return!!c})()"
    );
    return !!state;
  } catch(e) {
    return false;
  }
}

/**
 * 提取二维码：CDP 裁剪截图（绕过 canvas cross-origin 污染限制）
 * 返回 base64 PNG 供 agent 展示，同时保存到项目目录供终端用户查看
 * @param {object} cdp - CDP client（需有 sendCommand / evaluate / evaluateInFrame）
 * @param {function} onProgress - 进度回调
 * @returns {Promise<{base64:string}|null>}
 */
async function _extractQrCode(cdp, onProgress) {
  try {
    var iframeRect = await cdp.evaluate(
      "(function(){var f=document.getElementById('alibaba-login-box');var r=f.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()"
    );
    var canvasRect = await cdp.evaluateInFrame('alibaba-login-box',
      "(function(){var c=document.querySelector('canvas');if(!c)return{found:false};var r=c.getBoundingClientRect();return{found:true,x:r.x,y:r.y,w:r.width,h:r.height}})()"
    );
    if (!canvasRect || !canvasRect.found) return null;

    // CDP 裁剪截图（浏览器级，绕过 canvas cross-origin 污染限制）
    var pad = 20;
    var ssResult = await cdp.sendCommand('Page.captureScreenshot', {
      format: 'png',
      clip: {
        x: Math.round(iframeRect.x + canvasRect.x - pad),
        y: Math.round(iframeRect.y + canvasRect.y - pad),
        width: Math.round(canvasRect.w + pad * 2),
        height: Math.round(canvasRect.h + pad * 2),
        scale: 1
      }
    });
    var base64 = ssResult.data;

    var fs = require('fs');
    var outPath = require('path').join(__dirname, '..', 'qr-code.png');
    fs.writeFileSync(outPath, Buffer.from(base64, 'base64'));
    onProgress('[AUTH] 二维码已生成: ' + outPath);

    return { base64: base64 };
  } catch(e) {
    return null;
  }
}

function _normalizeLoginMode(mode) {
  mode = String(mode || process.env.SYCM_LOGIN_MODE || 'auto').toLowerCase();
  return ['auto', 'password', 'sms', 'qr'].includes(mode) ? mode : 'auto';
}

function _getAuthOptions(options) {
  options = options || {};
  return {
    loginMode: _normalizeLoginMode(options.loginMode),
    username: options.username || '',
    password: options.password || '',
    phone: options.phone || '',
    smsCode: options.smsCode || '',
    waitMs: options.loginWaitMs || 120000
  };
}

function _loginSucceededUrl(url) {
  return (url.includes('sycm.taobao.com') || url.match(/https?:\/\/(www\.)?myseller\.taobao\.com/)) && !url.includes('custom/login');
}

async function _waitForLoginSuccess(cdp, targetUrl, onProgress, waitMs, label) {
  onProgress('[AUTH] 等待登录成功...');
  var startTime = Date.now();
  while (Date.now() - startTime < waitMs) {
    await new Promise(function(r) { setTimeout(r, 3000); });
    try {
      var url = await cdp.evaluate("window.location.href", 5000);
      if (_loginSucceededUrl(url)) {
        onProgress('[AUTH] ' + label + '登录成功');
        onProgress('[AUTH] 登录成功，导航到目标页面...');
        await cdp.runAction("window.location.href = " + JSON.stringify(targetUrl), 5000);
        await new Promise(function(r) { setTimeout(r, 5000); });
        return true;
      }
    } catch (e) {}
  }
  return false;
}

async function _setInputValue(cdp, selector, value) {
  return cdp.evaluateInFrame('alibaba-login-box',
    "(function(){" +
    "var selectors=" + JSON.stringify(selector) + ".split(',');" +
    "var inp=null;" +
    "for(var i=0;i<selectors.length;i++){inp=document.querySelector(selectors[i].trim());if(inp)break;}" +
    "if(!inp)return 'not_found';" +
    "var proto=inp.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;" +
    "var desc=Object.getOwnPropertyDescriptor(proto,'value');" +
    "if(desc&&desc.set){desc.set.call(inp," + JSON.stringify(value) + ");}else{inp.value=" + JSON.stringify(value) + ";}" +
    "inp.dispatchEvent(new Event('input',{bubbles:true}));" +
    "inp.dispatchEvent(new Event('change',{bubbles:true}));" +
    "return 'ok';" +
    "})()"
  );
}

async function _clickLoginElement(cdp, selector, textHints) {
  return cdp.evaluateInFrame('alibaba-login-box',
    "(function(){" +
    "var selector=" + JSON.stringify(selector || '') + ";" +
    "var hints=" + JSON.stringify(textHints || []) + ";" +
    "var el=selector?document.querySelector(selector):null;" +
    "if(!el&&hints.length){" +
    "var nodes=document.querySelectorAll('a,button,div,span,label');" +
    "for(var i=0;i<nodes.length;i++){" +
    "var text=(nodes[i].textContent||'').replace(/\\s+/g,'');" +
    "for(var j=0;j<hints.length;j++){if(text.indexOf(hints[j])>=0){el=nodes[i];break;}}" +
    "if(el)break;" +
    "}" +
    "}" +
    "if(!el)return 'not_found';" +
    "el.click();" +
    "return 'ok';" +
    "})()"
  );
}

async function _hasSlider(cdp) {
  try {
    var hasSlider = await cdp.evaluateInFrame('alibaba-login-box',
      "(function(){var text=document.body?document.body.textContent:'';return /滑块|验证|安全检测/.test(text)||!!document.querySelector('.nc-lang-cnt,#nc_1_n1z,.nc-container')})()"
    );
    return !!hasSlider;
  } catch (e) {
    return false;
  }
}

async function _loginWithPassword(cdp, auth, targetUrl, onProgress) {
  if (!auth.username || !auth.password) {
    throw new Error('[AUTH] 自动密码登录已停用，请使用人工登录态缓存');
  }

  onProgress('[AUTH] 密码登录模式...');
  await _clickLoginElement(cdp, 'a.password-login-tab-item,.password-login-tab-item', ['密码登录', '账号登录']);
  await new Promise(function(r) { setTimeout(r, 1000); });

  await _setInputValue(cdp, '#fm-login-id,input[name="fm-login-id"],input[name="loginId"],input[type="text"]', auth.username);
  await _setInputValue(cdp, '#fm-login-password,input[name="fm-login-password"],input[type="password"]', auth.password);
  await _clickLoginElement(cdp, 'button.fm-submit,.fm-submit,button[type="submit"]', ['登录']);

  await new Promise(function(r) { setTimeout(r, 2000); });
  if (await _hasSlider(cdp)) {
    onProgress('[AUTH] 检测到滑块/安全验证，改用扫码或人工处理...');
    return false;
  }
  return _waitForLoginSuccess(cdp, targetUrl, onProgress, auth.waitMs, '密码');
}

async function _loginWithSms(cdp, auth, targetUrl, onProgress) {
  if (!auth.phone) {
    throw new Error('[AUTH] 自动验证码登录已停用，请使用人工登录态缓存');
  }

  onProgress('[AUTH] 手机验证码登录模式...');
  await _clickLoginElement(cdp, '.sms-login-tab-item,a.sms-login-tab-item', ['短信登录', '验证码登录', '手机登录']);
  await new Promise(function(r) { setTimeout(r, 1000); });

  await _setInputValue(cdp, '#fm-login-id,input[name="fm-login-id"],input[name="loginId"],input[name="phone"],input[type="tel"],input[type="text"]', auth.phone);
  var sendResult = await _clickLoginElement(cdp, 'a.send-btn-link,.send-btn-link,.sms-send-btn,.send-code', ['获取验证码', '发送验证码', '获取校验码', '发送校验码']);
  if (String(sendResult) === 'not_found') {
    onProgress('[AUTH] 未找到发送验证码按钮，请在浏览器里手动点击发送');
  } else {
    onProgress('[AUTH] 已点击获取验证码');
  }

  await new Promise(function(r) { setTimeout(r, 2000); });
  if (await _hasBaxiaCaptcha(cdp)) {
    onProgress('[AUTH] 获取验证码前触发滑块验证，请先在浏览器里完成滑动验证');
    throw new Error('slider_required: 已点击获取验证码，但淘宝要求先完成滑块验证；请在浏览器中滑动验证后重试');
  }

  if (auth.smsCode) {
    await _setInputValue(cdp, '#fm-sms-code,#fm-login-code,input[name="smsCode"],input[name="code"],input[placeholder*="验证码"]', auth.smsCode);
    await _clickLoginElement(cdp, 'button.fm-submit,.fm-submit,button[type="submit"]', ['登录']);
  } else {
    onProgress('[AUTH] 未提供验证码，已停在短信验证码登录页');
    throw new Error('sms_code_required: 已点击获取验证码，请提供短信验证码后使用 --sms-code 继续登录');
  }

  if (await _waitForLoginSuccess(cdp, targetUrl, onProgress, auth.waitMs, '验证码')) {
    return true;
  }
  if (!auth.smsCode) return false;
  throw new Error('验证码登录超时（' + Math.round(auth.waitMs / 1000) + '秒），请确认验证码是否正确');
}

async function _hasBaxiaCaptcha(cdp) {
  try {
    var tree = await cdp.sendCommand('Page.getFrameTree', {});
    var found = false;
    function walk(node) {
      if (!node || !node.frame) return;
      var name = node.frame.name || '';
      var url = node.frame.url || '';
      if (name === 'baxia-dialog-content' || url.includes('/punish') || url.includes('action=captcha')) {
        found = true;
      }
      (node.childFrames || []).forEach(walk);
    }
    walk(tree.frameTree);
    return found;
  } catch (e) {
    return false;
  }
}

async function _waitForQrLogin(cdp, targetUrl, onProgress, waitMs) {
  var qrData = await _extractQrCode(cdp, onProgress);

  onProgress('[AUTH] 请使用千牛 APP 扫描二维码登录...');
  onProgress('[AUTH] 等待最多 ' + Math.round(waitMs / 1000) + ' 秒...');
  if (await _waitForLoginSuccess(cdp, targetUrl, onProgress, waitMs, '扫码')) {
    return { qrData: qrData };
  }
  throw new Error('等待登录超时（' + Math.round(waitMs / 1000) + '秒），请手动登录后重试');
}

async function _ensureSycmLoggedIn(cdp, targetUrl, onProgress, options) {
  var auth = _getAuthOptions(options);

  // Step 1: Navigate to loginmyseller.taobao.com
  onProgress('[AUTH] 导航到 loginmyseller.taobao.com...');
  await cdp.runAction("window.location.href = 'https://loginmyseller.taobao.com/'", 5000);
  await new Promise(function(r) { setTimeout(r, 3000); });

  // Step 2: Wait for iframe to load (poll Page.getFrameTree)
  onProgress('[AUTH] 等待登录 iframe 加载...');
  var loginFrameId = null;
  for (var i = 0; i < 10; i++) {
    try {
      var tree = await cdp.sendCommand('Page.getFrameTree', {});
      var children = tree.frameTree.childFrames || [];
      var frame = children.find(function(f) { return f.frame.name === 'alibaba-login-box'; });
      if (frame) { loginFrameId = frame.frame.id; break; }
    } catch (e) {}
    await new Promise(function(r) { setTimeout(r, 1000); });
  }
  if (!loginFrameId) throw new Error('[AUTH] 未检测到登录 iframe，请重试');

  onProgress('[AUTH] 检测到登录 iframe');

  if (auth.loginMode === 'password') {
    if (await _loginWithPassword(cdp, auth, targetUrl, onProgress)) return { qrData: null };
    if (auth.phone) {
      onProgress('[AUTH] 密码登录未完成，尝试手机验证码登录...');
      if (await _loginWithSms(cdp, auth, targetUrl, onProgress)) return { qrData: null };
    } else {
      throw new Error('[AUTH] 未配置手机号，无法降级到验证码登录');
    }
  } else if (auth.loginMode === 'sms') {
    if (await _loginWithSms(cdp, auth, targetUrl, onProgress)) return { qrData: null };
  } else if (auth.loginMode === 'auto') {
    if (auth.username && auth.password && await _loginWithPassword(cdp, auth, targetUrl, onProgress)) return { qrData: null };
    if (auth.phone && await _loginWithSms(cdp, auth, targetUrl, onProgress)) return { qrData: null };
  }

  throw new Error('[AUTH] 登录未完成；扫码登录已暂停，请使用手机验证码登录');
}

function _extractCategoryAnalysis(cdp) {
  return new Promise(async function(resolve) {
    try {
      var tabResult = await cdp.runAction(
        "(() => { " +
        "  var spans = document.querySelectorAll('span.oui-tab-switch-item'); " +
        "  for (var i = 0; i < spans.length; i++) { " +
        "    var text = (spans[i].textContent || '').trim(); " +
        "    if (text === '类目分析') { " +
        "      spans[i].click(); " +
        "      return 'clicked:' + text; " +
        "    } " +
        "  } " +
        "  return 'not_found'; " +
        "})()",
        10000
      );

      if (String(tabResult).indexOf('not_found') >= 0) {
        resolve({ headers: [], rows: [] });
        return;
      }

      var tableFound = false;
      for (var i = 0; i < 5; i++) {
        await new Promise(function(r) { setTimeout(r, 2000); });
        var rowCount = await cdp.evaluate(
          "document.querySelectorAll('.ant-table-tbody tr').length",
          5000
        );
        if (rowCount > 0) {
          tableFound = true;
          break;
        }
      }

      if (!tableFound) {
        resolve({ headers: [], rows: [] });
        return;
      }

      var extractResult = await cdp.evaluate(
        "(() => { " +
        "  var result = { headers: [], rows: [] }; " +
        "  var thElements = document.querySelectorAll('.ant-table-thead th'); " +
        "  for (var i = 0; i < thElements.length; i++) { " +
        "    result.headers.push(thElements[i].textContent.trim()); " +
        "  } " +
        "  var trElements = document.querySelectorAll('.ant-table-tbody tr'); " +
        "  for (var i = 0; i < trElements.length; i++) { " +
        "    var row = {}; " +
        "    var tdElements = trElements[i].querySelectorAll('td'); " +
        "    for (var j = 0; j < tdElements.length; j++) { " +
        "      var cellText = tdElements[j].textContent.trim(); " +
        "      if (result.headers[j]) { " +
        "        var header = result.headers[j]; " +
        "        if (header.includes('类目') || header.includes('品类')) { " +
        "          row.category = cellText; " +
        "        } else if (header.includes('点击') && header.includes('占比')) { " +
        "          var numStr = cellText.replace('%', ''); " +
        "          row.clickRatio = parseFloat(numStr) || 0; " +
        "        } else if (header.includes('点击') && header.includes('率')) { " +
        "          var numStr = cellText.replace('%', ''); " +
        "          row.clickRate = parseFloat(numStr) || 0; " +
        "        } " +
        "      } " +
        "    } " +
        "    if (row.category) { " +
        "      result.rows.push(row); " +
        "    } " +
        "  } " +
        "  return JSON.stringify(result); " +
        "})()",
        15000
      );

      var parsed;
      try {
        parsed = (typeof extractResult === 'string') ? JSON.parse(extractResult) : extractResult;
      } catch (e) {
        parsed = { headers: [], rows: [] };
      }

      resolve(parsed);
    } catch (error) {
      resolve({ headers: [], rows: [], error: error.message || String(error) });
    }
  });
}

function _recommendCategory(categoryData) {
  if (!categoryData || !categoryData.rows || categoryData.rows.length === 0) {
    return { recommended: null, ranking: [], reason: '无类目数据' };
  }
  
  var rows = categoryData.rows;
  var maxClickRatio = Math.max(...rows.map(function(r) { return r.clickRatio; }));
  var maxClickRate = Math.max(...rows.map(function(r) { return r.clickRate; }));
  
  var scoredRows = rows.map(function(r) {
    var score = (r.clickRatio / maxClickRatio) * 0.6 + (r.clickRate / maxClickRate) * 0.4;
    return Object.assign({}, r, { score: score });
  });
  
  var sortedRows = scoredRows.sort(function(a, b) { return b.score - a.score; });
  var recommended = sortedRows[0];
  
  return {
    recommended: recommended,
    ranking: sortedRows,
    reason: '点击人数占比' + recommended.clickRatio + '%，点击率' + recommended.clickRate + '%'
  };
}

module.exports = {
  extractSycmData: extractSycmData,
  _extractCategoryAnalysis: _extractCategoryAnalysis,
  _recommendCategory: _recommendCategory,
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
