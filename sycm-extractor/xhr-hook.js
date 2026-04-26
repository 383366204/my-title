// xhr-hook.js — 在页面上下文 (MAIN world) 中拦截 XHR/fetch 请求
// 通过 postMessage 将数据传给 content.js (isolated world)

(function() {
  'use strict';
  
  console.log('[SYCM-XHR] 生意参谋数据提取脚本已加载 (MAIN world)');
  
  // 匹配淘宝生意参谋搜索分析的 API URL
  const SYCM_API_PATTERNS = [
    // 淘宝生意参谋 API 模式  
    /sycm\.taobao\.com\/.*search/i,
    /sycm\.taobao\.com\/.*keyword/i,
    /sycm\.taobao\.com\/.*word/i,
    /sycm\.taobao\.com\/.*data/i,
    /sycm\.taobao\.com\/.*list/i,
    /sycm\.taobao\.com\/.*result/i
  ];
  
  // 排除不相关的 API
  const EXCLUDE_PATTERNS = [
    /\.(js|css|png|jpg|gif|svg|ico)$/i,
    /\/vendor\//i,
    /\/lib\//i,
    /\/static\//i,
    /analytics/i,
    /tracking/i,
    /monitor/i
  ];
  
  function isSycmApiUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    // 排除不相关的 URL
    if (EXCLUDE_PATTERNS.some(pattern => pattern.test(url))) {
      return false;
    }
    
    // 只检查淘宝生意参谋域名
    if (!url.includes('sycm.taobao.com')) {
      return false;
    }
    
    // 匹配 API 模式
    return SYCM_API_PATTERNS.some(pattern => pattern.test(url));
  }
  
  // 拦截 XMLHttpRequest
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._sycmUrl = url;
    this._sycmMethod = method;
    return originalXhrOpen.apply(this, [method, url, ...args]);
  };
  
  XMLHttpRequest.prototype.send = function(...args) {
    const self = this;
    const url = this._sycmUrl;
    
    if (url && isSycmApiUrl(url)) {
      // 添加 load 事件监听器
      const originalOnLoad = this.onload;
      this.onload = function(event) {
        try {
          if (originalOnLoad) {
            originalOnLoad.call(this, event);
          }
          
          if (this.readyState === 4 && this.status >= 200 && this.status < 300) {
            const responseText = this.responseText;
            if (responseText) {
              try {
                const data = JSON.parse(responseText);
                console.log('[SYCM-XHR] 捕获到生意参谋 API 响应:', url);
                window.postMessage({ 
                  type: 'sycm-api-data', 
                  source: 'xhr', 
                  url: url,
                  method: self._sycmMethod,
                  status: this.status,
                  data: data 
                }, '*');
              } catch (parseError) {
                console.log('[SYCM-XHR] JSON 解析失败，可能是非 JSON 响应:', parseError.message);
              }
            }
          }
        } catch (error) {
          console.error('[SYCM-XHR] XHR 拦截处理错误:', error);
        }
      };
      
      // 添加 readystatechange 事件监听器作为备用
      const originalOnReadyStateChange = this.onreadystatechange;
      this.onreadystatechange = function(event) {
        try {
          if (originalOnReadyStateChange) {
            originalOnReadyStateChange.call(this, event);
          }
          
          if (this.readyState === 4 && this.status >= 200 && this.status < 300) {
            const responseText = this.responseText;
            if (responseText) {
              try {
                const data = JSON.parse(responseText);
                console.log('[SYCM-XHR] 通过 readystatechange 捕获 API 响应:', url);
                window.postMessage({ 
                  type: 'sycm-api-data', 
                  source: 'xhr', 
                  url: url,
                  method: self._sycmMethod,
                  status: this.status,
                  data: data 
                }, '*');
              } catch (parseError) {
                // 忽略非 JSON 响应
              }
            }
          }
        } catch (error) {
          console.error('[SYCM-XHR] readystatechange 处理错误:', error);
        }
      };
    }
    
    return originalXhrSend.apply(this, args);
  };
  
  // 拦截 fetch
  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    
    if (!isSycmApiUrl(url)) {
      return originalFetch.apply(this, [input, init]);
    }
    
    try {
      const response = await originalFetch.apply(this, [input, init]);
      const clonedResponse = response.clone();
      
      // 检查是否为 JSON 响应
      const contentType = clonedResponse.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          const data = await clonedResponse.json();
          console.log('[SYCM-XHR] 捕获到 fetch API 响应:', url);
          window.postMessage({ 
            type: 'sycm-api-data', 
            source: 'fetch', 
            url: url,
            method: init?.method || 'GET',
            status: clonedResponse.status,
            data: data 
          }, '*');
        } catch (jsonError) {
          console.error('[SYCM-XHR] fetch JSON 解析失败:', jsonError);
        }
      } else {
        // 尝试作为文本解析（有些 API 可能返回 text/plain 但内容是 JSON）
        try {
          const text = await clonedResponse.text();
          const trimmedText = text.trim();
          if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
            const data = JSON.parse(trimmedText);
            console.log('[SYCM-XHR] 捕获到文本格式的 API 响应:', url);
            window.postMessage({ 
              type: 'sycm-api-data', 
              source: 'fetch', 
              url: url,
              method: init?.method || 'GET',
              status: clonedResponse.status,
              data: data 
            }, '*');
          }
        } catch (textError) {
          // 忽略非 JSON 文本
        }
      }
      
      return response;
    } catch (error) {
      console.error('[SYCM-XHR] fetch 拦截错误:', error);
      // 出错时回退到原始 fetch
      return originalFetch.apply(this, [input, init]);
    }
  };
  
  // 监听来自 content.js 的请求
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'sycm-xhr-request') {
      console.log('[SYCM-XHR] 收到 content.js 请求:', event.data);
    }
  });
  
  console.log('[SYCM-XHR] XHR/fetch 拦截器已安装');
})();