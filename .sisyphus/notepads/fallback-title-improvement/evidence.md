Summary of changes and QA results for fallback title construction
- Added constructFallbackTitle function to src/title-utils.js (before module.exports)
- Updated exports to include constructFallbackTitle
- Syntax check passed: node -c src/title-utils.js
- QA results (examples):
  - Normal fallback: length 22, starts with blueOceanWord
  - With Taobao titles: length 16, includes additional segments when available
  - Empty original: returns only blueOceanWord (length equal to word)
  - Different from orig: result differs from original as expected

Notes:
- Evidence logs saved to .sisyphus/evidence/task-1-*.txt
- Adjust MAX_SEGMENTS or TAOBAO aggregation rules if longer titles are desired
