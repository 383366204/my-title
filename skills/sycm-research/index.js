const sycmCdp = require('./src/sycm-cdp-extractor');
const sycmBrowser = require('./src/sycm-browser-helper');

module.exports = {
  extractSycmData: sycmCdp.extractSycmData,
  isChromeDevToolsAvailable: sycmBrowser.isChromeDevToolsAvailable,
  autoLaunchChrome: sycmBrowser.autoLaunchChrome,
  DEFAULT_FILTER_CONDITIONS: sycmCdp.DEFAULT_FILTER_CONDITIONS,
  VALID_COMPARE_TYPES: sycmCdp.VALID_COMPARE_TYPES,
  VALID_PERIODS: sycmCdp.VALID_PERIODS,
  DEFAULT_PAGE_FILTERS: sycmCdp.DEFAULT_PAGE_FILTERS
};
