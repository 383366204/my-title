/**
 * 共享常量定义
 * 从 extract-core.js 中提取，消除 glm-client ↔ extract-core 循环依赖
 */

const RIGIDITY_RULES_TEXT = `- 材质相关词（如"纯银"、"纯棉"、"真皮"）→ rigid
- 颜色相关词（如"黑色"、"白色"、"金色"）→ rigid
- 规格尺寸（如"XL"、"加大"、"长款"）→ rigid
- 目标人群（如"女"、"男"、"学生"）→ rigid
- 品类限定词 → rigid（如"猫咪"限定宠物用品、"婴儿"限定婴儿用品、"汽车"限定汽车用品。这些词虽然不是材质/颜色/规格，但不匹配则商品完全错误）
- 风格（如"韩版"、"ins风"、"简约"）→ optional
- 流行词（如"高级感"、"气质"、"百搭"）→ optional
- 时间/季节（如"新款"、"夏季"、"2026"）→ optional`;

module.exports = { RIGIDITY_RULES_TEXT };
