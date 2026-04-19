# Decisions — title-quality-fixes

## 2026-04-18
- 标点移除：白名单法（保留字母数字+中文字，移除所有CJK/ASCII标点）
- 长度目标：最小20字符，目标25-30中文字，最大60字符（JS .length单位）
- 短标题策略：丢弃不填充
- titleMap匹配：精确匹配 + String(id).trim() 归一化
- Fallback标题：blueOceanWord + rigidWords.join('')，跳过已含在蓝海词中的coreWord
- 后处理管线顺序：removeBannedWords → cleanTitle → ensureBlueOceanPrefix → normalizeLength → removeSpaces
