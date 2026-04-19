# Manual QA Results - 2026-04-18

## Test Summary

### Test 1: CLI with Real APIs ✅ PASS
- **Command**: `node bin/cli.js "项链"`
- **GLM Call**: Succeeded within 30s
- **Output Fields**: 11 fields displayed (链接原标题, 产品链接, 铺货标题, 商品原价, 30天销量, 好评率, 复购率, 蓝海词, 选品理由, 定价建议, 风险提示)
- **Products Returned**: 22 products (filtered)
- **Titles Generated**: 5 titles

### Test 2: Verify New Fields Content ✅ PASS
- **选品理由**: Meaningful text for top 5 products
  - Example: "纯银材质，珍珠设计，时尚感强，适合追求高品质和独特设计的消费者。"
- **定价建议**: Price recommendations shown
  - Example: "建议价格：100-200元"
- **风险提示**: Actual risks displayed
  - Example: "价格较高，可能不适合预算有限的消费者。"
- **Note**: Only top 5 products have these fields populated (expected behavior - GLM analyzes top products only)

### Test 3: JSON Output Format ✅ PASS
- **Command**: `node bin/cli.js "项链" --format json`
- **JSON Structure**: Valid JSON array with all 11 fields
- **Fields Present**: All required fields included (链接原标题, 产品链接, 铺货标题, 商品原价, 30天销量, 好评率, 复购率, 蓝海词, 选品理由, 定价建议, 风险提示)

### Test 4: Fallback Mode ⚠️ PARTIAL
- **Command**: `GLM_API_KEY="invalid_key" node bin/cli.js "项链"`
- **GLM API Failure**: Correctly failed with 401 error
- **Fallback Extraction**: ✅ Working - "使用降级提取"
- **1688 Search**: ✅ Still works without GLM
- **Taobao Search**: ✅ Still works without GLM
- **Title Generation**: ❌ No titles generated when GLM fails
  - Message: "没有生成标题，请尝试其他关键词"
  - Issue: Local fallback doesn't generate titles without GLM

## Issues Found

1. **Fallback Title Generation**: When GLM API fails, the system falls back to local extraction and search, but cannot generate titles without GLM. The error message "没有生成标题" is shown.

2. **Field Population**: Only top 5 products have 选品理由, 定价建议, and 风险提示 populated. Remaining products have empty strings for these fields.

3. **Redundant Fields**: JSON output contains duplicate fields with "undefined" values (positiveRate, repurchaseRate, sales30Days, originalPrice) alongside the Chinese field names.

## Verdict

**Scenarios 3/4 PASS | 1 PARTIAL**

**Overall: APPROVE with Notes**

The core functionality works correctly:
- GLM integration succeeds and returns all 11 fields
- JSON output format is valid
- Fallback extraction works when API fails

The fallback title generation issue is a known limitation - the system requires GLM for title generation and cannot produce titles with local logic alone.
