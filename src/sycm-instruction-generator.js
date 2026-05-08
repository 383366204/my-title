/**
 * SYCM (生意参谋) 自动化指令生成器
 * 生成 chrome-devtools-mcp 操作指令，用于自动化采集搜索分析数据
 * 支持单页提取和多页全量遍历两种模式
 */

function getSycmPageUrl(keyword) {
  return `https://sycm.taobao.com/mc/free/search_analysis?keyWord=${encodeURIComponent(keyword)}`;
}

/**
 * 列名→字段名映射表（Unicode 转义避免编码问题）
 */
var SYCM_HEADER_MAP = {
  '\\u76f8\\u5173\\u641c\\u7d22\\u8bcd': 'keyword',
  '\\u641c\\u7d22\\u8bcd': 'keyword',
  '\\u641c\\u7d22\\u4eba\\u6c14': 'searchPopularity',
  '\\u70b9\\u51fb\\u7387': 'clickRate',
  '\\u652f\\u4ed8\\u8f6c\\5316\\u7387': 'conversionRate',
  '\\u652f\\u4ed8\\u4e70\\5bb6\\u6570': 'buyerCount',
  '\\u9700\\u6c42\\u4f9b\\u7ed9\\u6bd4': 'demandSupplyRatio',
  '\\u5929\\u732b\\u5546\\u54c1\\u70b9\\u51fb\\u5360\\u6bd4': 'tmallClickShare'
};

/**
 * 生成单页数据提取脚本（注入浏览器上下文执行）
 * 从当前页面的 DOM 表格中提取搜索分析数据（仅当前页）
 * @returns {string} 可注入浏览器的 JavaScript 脚本字符串
 */
function generateDataExtractionScript() {
  return `(() => {
    var H = ${JSON.stringify(SYCM_HEADER_MAP)};
    function pv(s){if(!s||typeof s!=='string')return{v:0,t:''};var st=s.trim();var tm=st.match(/\\s*[+-]?[\\d.]+%$/);var tr=tm?tm[0].trim():'';if(tr&&tr.length>=st.length)tr='';var vp=tr?st.substring(0,st.length-tr.length).trim():st;var rg=vp.match(/^(.+?)\\s*~+\\s*(.+)$/);if(rg)return{v:vp,t:tr};var pc=vp.match(/^(\\d+(?:\\.\\d+)?)%$/);if(pc)return{v:parseFloat(pc[1]),t:tr};var wn=vp.match(/^(\\d+(?:\\.\\d+)?)\\s*\\u4e07$/);if(wn)return{v:Math.round(parseFloat(wn[1])*10000),t:tr};var nm=parseFloat(vp);return{v:isNaN(nm)?vp:nm,t:tr}}
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
 * 生成多页全量提取指令集（翻页遍历模式）
 * 通过多次 evaluate_script + 点击下一页按钮实现全量数据采集
 *
 * 使用方式：按 instructions 数组顺序逐步执行
 *   步骤 3（勾选checkbox+等待列）只需执行一次
 *   步骤 4（提取当前页）+ 步骤 5（点击下一页）循环执行直到步骤5返回 disabled
 *
 * @param {string} keyword - 搜索关键词
 * @param {Object} [options={}] - 配置选项
 * @returns {Object} 多页提取完整指令集
 */
function generateMultiPageInstructions(keyword, options) {
  options = options || {};
  var port = options.port || 9222;
  var targetUrl = getSycmPageUrl(keyword);
  var singlePageScript = generateDataExtractionScript();

  var chromeLaunchCmd = '';
  try {
    var helper = require('./sycm-browser-helper');
    chromeLaunchCmd = helper.generateChromeLaunchCommand({ port: port }).command;
  } catch (e) {
    chromeLaunchCmd = 'google-chrome --remote-debugging-port=' + port + ' --user-data-dir=/tmp/sycm-chrome-profile --no-first-run';
  }

  return {
    chromeRequired: true,
    chromeLaunchCmd: chromeLaunchCmd,
    targetUrl: targetUrl,
    mode: 'multi_page',
    singlePageScript: singlePageScript,
    instructions: [
      {
        step: 1,
        tool: 'navigate_page',
        description: '\u6253\u5f00\u751f\u610f\u53c2\u8c0b\u641c\u7d22\u5206\u6790\u9875\u9762',
        args: { url: targetUrl }
      },
      {
        step: 2,
        tool: 'wait_for',
        description: '\u7b49\u5f85\u641c\u7d22\u7ed3\u679c\u8868\u683c\u52a0\u8f7d\uff08\u6700\u957f30\u79d2\uff09',
        args: { timeout: 30000 }
      },
      {
        step: 3,
        tool: 'evaluate_script',
        description: '\u521d\u59cb\u5316\uff1a\u52fe\u9009\u5168\u90e86\u4e2a\u6307\u6807checkbox \u2192 \u7b49\u5f857+\u5217\u8868\u5934 \u2192 \u56de\u5230\u7b2c1\u9875',
        args: {
          script: `(() => {
            var g=document.querySelector('.ant-checkbox-group.low-Checkbox-v2');
            if(g){var ins=g.querySelectorAll('input[type=checkbox]');ins.forEach(function(i){if(!i.checked)i.click()});var ws=Date.now();while(Date.now()-ws<30000){var th=document.querySelectorAll('.ant-table-thead th');if(th.length>=7)break}var p1=document.querySelector('.ant-pagination-item-1');if(p1)p1.click()}
            return document.querySelectorAll('.ant-table-thead th').length
          })()`,
          timeout: 45000
        }
      },
      {
        step: 4,
        tool: 'evaluate_script',
        description: '\u63d0\u53d6\u5f53\u524d\u9875\u6570\u636e\uff08\u91cd\u590d\u6267\u884c\u6bcf\u9875\uff09',
        args: { script: singlePageScript, timeout: 25000 },
        repeatable: true
      },
      {
        step: 5,
        tool: 'evaluate_script',
        description: '\u70b9\u51fb\u201c\u4e0b\u4e00\u9875\u201d\u6309\u94ae\uff08\u8fd4\u56dedisabled\u5219\u5230\u8fbe\u672b\u9875\uff09',
        args: {
          script: `(() => { var btn=document.querySelector('.ant-pagination-next'); if(btn&&!btn.classList.contains('ant-pagination-disabled')){btn.click();return 'clicked'} return 'disabled:'+(!!btn) })()`,
          timeout: 10000
        },
        repeatable: true
      },
      {
        step: 6,
        tool: 'wait_for',
        description: '\u7b49\u5f85\u9875\u9762\u6e32\u67d3\uff08\u7ffb\u9875\u540e4\u79d2\uff09',
        args: { timeout: 4000 },
        repeatable: true
      }
    ],
    loopLogic: {
      description: '\u5728\u6b65\u9aa44-6 \u4e4b\u540e\u5faa\u73af\u6267\u884c: step4 \u2192 step5 \u2192 step6\uff0c\u76f4\u5230 step5 \u8fd4\u56de disabled',
      dedupCheck: '\u5bf9\u6bd4\u4e0a\u4e00\u9875\u6700\u540e\u4e00\u6761 keyword\uff0c\u76f8\u540c\u5219\u8df3\u8fc7\u91cd\u8bd5',
      nextPageWaitMs: 4000
    },
    fallbackHint: '\u5982\u679c chrome-devtools-mcp \u4e0d\u53ef\u7528\uff0c\u8bf7\u624b\u52a8\u64cd\u4f5c\uff1a\n1. \u5728 Chrome \u4e2d\u767b\u5f55\u6dd8\u5b98\u8d26\u53f7\n2. \u8bbf\u95ee ' + targetUrl + '\n3. \u7b49\u5f85\u6570\u636e\u52a0\u8f7d\n4. \u4f7f\u7528 sycm-extractor \u63d2\u4ef6\u63d0\u53d6\u6570\u636e\n5. \u6570\u636e\u4f1a\u81ea\u52a8\u53d1\u9001\u5230 POST /api/extract',
    captchaHint: '\u5982\u679c\u9047\u5230\u9a8c\u8bc1\u7801\u6216\u6ed1\u5757\uff0c\u8bf7\u5728\u6d4f\u89c8\u5668\u4e2d\u624b\u52a8\u5b8c\u6210\u9a8c\u8bc1\uff0c\u7136\u540e\u91cd\u65b0\u6267\u884c\u6b65\u9aa43'
  };
}

/**
 * 生成 SYCM 查询完整指令集（兼容旧版单页模式）
 * @param {string} keyword - 搜索关键词
 * @param {Object} [options={}] - 配置选项
 * @param {number} [options.port=9222] - Chrome 远程调试端口
 * @param {boolean} [options.multiPage=false] - 是否启用多页遍历模式
 * @returns {Object} 完整指令集
 */
function generateSycmQueryInstructions(keyword, options) {
  options = options || {};
  if (options.multiPage) {
    return generateMultiPageInstructions(keyword, options);
  }

  var port = options.port || 9222;
  var targetUrl = getSycmPageUrl(keyword);
  var extractionScript = generateDataExtractionScript();

  var chromeLaunchCmd = '';
  try {
    var helper = require('./sycm-browser-helper');
    chromeLaunchCmd = helper.generateChromeLaunchCommand({ port: port }).command;
  } catch (e) {
    chromeLaunchCmd = 'google-chrome --remote-debugging-port=' + port + ' --user-data-dir=/tmp/sycm-chrome-profile --no-first-run';
  }

  return {
    chromeRequired: true,
    chromeLaunchCmd: chromeLaunchCmd,
    targetUrl: targetUrl,
    mode: 'single_page',
    instructions: [
      {
        step: 1,
        tool: 'navigate_page',
        description: '\u6253\u5f00\u751f\u610f\u53c2\u8c0b\u641c\u7d22\u5206\u6790\u9875\u9762',
        args: { url: targetUrl }
      },
      {
        step: 2,
        tool: 'wait_for',
        description: '\u7b49\u5f85\u641c\u7d22\u7ed3\u679c\u6570\u636e\u8868\u683c\u52a0\u8f7d\uff08\u6700\u957f30\u79d2\uff09',
        args: { timeout: 30000 }
      },
      {
        step: 3,
        tool: 'evaluate_script',
        description: '\u63d0\u53d6\u641c\u7d22\u5206\u6790\u6570\u636e\uff08\u52fe\u9009\u5168\u90e86\u9879\u6307\u6807 \u2192 \u7b49\u5f85\u6e32\u67d3 \u2192 \u63d0\u53d6\u5f53\u524d\u9875\uff09',
        args: { script: extractionScript }
      }
    ],
    extractionScript: extractionScript,
    fallbackHint: '\u5982\u679c chrome-devtools-mcp \u4e0d\u53ef\u7528\uff0c\u8bf7\u624b\u52a8\u64cd\u4f5c\uff1a\n1. \u5728 Chrome \u4e2d\u767b\u5f55\u6dd8\u5b98\u8d26\u53f7\n2. \u8bbf\u95ee ' + targetUrl + '\n3. \u7b49\u5f85\u6570\u636e\u52a0\u8f7d\n4. \u4f7f\u7528 sycm-extractor \u63d2\u4ef6\u63d0\u53d6\u6570\u636e\n5. \u6570\u636e\u4f1a\u81ea\u52a8\u53d1\u9001\u5230 POST /api/extract',
    captchaHint: '\u5982\u679c\u9047\u5230\u9a8c\u8bc1\u7801\u6216\u6ed1\u5757\uff0c\u8bf7\u5728\u6d4f\u89c8\u5668\u4e2d\u624b\u52a8\u5b8c\u6210\u9a8c\u8bc1\uff0c\u7136\u540e\u91cd\u65b0\u6267\u884c\u6b65\u9aa43'
  };
}

module.exports = {
  generateSycmQueryInstructions: generateSycmQueryInstructions,
  generateMultiPageInstructions: generateMultiPageInstructions,
  generateDataExtractionScript: generateDataExtractionScript,
  getSycmPageUrl: getSycmPageUrl
};
