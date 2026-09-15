'use strict';

const { stableHash } = require('./inspiration-sources');

const DIMENSION_LABELS = { persona: '人群', profession: '职业', hobby: '爱好', scene: '场景', problem: '痛点' };
const DEFAULT_DIMENSIONS = Object.keys(DIMENSION_LABELS);
// 记录需求而不是预设商品答案，具体词根交给商品化模型推导。
const DEMANDS = {
  persona: ['独居青年整理小厨房', '大学生整理宿舍床边空间', '带娃家庭外出携带餐食', '老年人夜间起床照明', '租房者搬家打包', '养猫家庭清理浮毛', '养犬家庭雨天遛犬', '新手司机整理车内物品', '出差人群收纳洗漱用品', '轮班人群白天遮光休息', '长发人群运动固定头发', '亲子家庭整理绘画材料'],
  profession: ['教师携带批改资料', '程序员整理桌面线材', '厨师高温厨房作业', '花艺师固定花束运输', '摄影师户外整理配件', '快递员雨天保护随身物品', '护士轮班携带餐食', '园艺工修剪后收集枝叶', '美容师收纳消毒后工具', '摊主夜市照明和展示', '手工艺人分类保存零件', '健身教练携带训练配件'],
  hobby: ['水彩爱好者外出写生', '钓鱼爱好者整理鱼钩配件', '露营爱好者夜间活动', '烘焙爱好者储存原料', '园艺爱好者阳台育苗', '骑行爱好者雨天出行', '徒步爱好者轻装整理', '拼图爱好者保存未完成作品', '编织爱好者整理线团', '茶艺爱好者保持桌面干燥', '模型爱好者防尘展示', '瑜伽爱好者携带练习用品'],
  scene: ['雨季门口收纳湿物', '小厨房利用垂直空间', '宿舍床铺夜间阅读', '办公室午休避光', '汽车长途旅行整理杂物', '浴室狭小台面整理', '阳台晾晒小件衣物', '户外野餐防风固定', '换季打包衣被', '火车旅行临时洗漱', '家庭生日整理桌面', '租房搬家分类标记'],
  problem: ['抽屉小物经常混杂', '厨房袋装原料开封受潮', '桌面充电线缠绕', '鞋子雨后难以晾干', '浴室积水导致物品湿滑', '出差衣物容易压皱', '眼镜携带容易压坏', '长时间握工具容易磨手', '宠物掉毛粘在布面', '夜间找物影响同住者', '开车随身物品滑落', '阳台种植浇水弄湿地面']
};

/**
 * 按日期和尝试编号稳定轮换需求；自定义输入全量保留。
 * @param {object} options 日期、尝试、启用维度及自定义需求。
 * @returns {Array<object>} 可直接商品化的需求灵感。
 */
function collectDimensionInspirations({ date = new Date().toISOString().slice(0, 10), runAttempt = 0, enabledDimensions = DEFAULT_DIMENSIONS, customInputs = {} } = {}) {
  const dimensions = Array.isArray(enabledDimensions) ? [...new Set(enabledDimensions)].filter(key => DEFAULT_DIMENSIONS.includes(key)) : DEFAULT_DIMENSIONS;
  return dimensions.flatMap(dimension => {
    const sampled = [...DEMANDS[dimension]].sort((a, b) => stableHash(`${date}:${runAttempt}:${a}`).localeCompare(stableHash(`${date}:${runAttempt}:${b}`))).slice(0, 4);
    const custom = (Array.isArray(customInputs[dimension]) ? customInputs[dimension] : []).map(value => String(value).trim()).filter(Boolean);
    return [...new Set([...custom, ...sampled])].map(text => ({
      id: `dimension_${stableHash(`${dimension}:${text}`)}`,
      sourceType: custom.includes(text) ? 'user_input' : 'knowledge_base',
      sourceTitle: custom.includes(text) ? `自定义${DIMENSION_LABELS[dimension]}` : `${DIMENSION_LABELS[dimension]}需求知识`,
      inspirationWord: text,
      contextWords: [text], rawSourceText: text, categoryHint: '',
      createdAt: `${date}T00:00:00+08:00`, status: 'pending', dimension,
      actor: ['persona', 'profession'].includes(dimension) ? text : '',
      task: text, scene: dimension === 'scene' ? text : '',
      problem: dimension === 'problem' ? text : '', purchaseJob: ''
    }));
  });
}

module.exports = { DIMENSION_LABELS, DEFAULT_DIMENSIONS, collectDimensionInspirations };
