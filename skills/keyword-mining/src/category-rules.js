const DEFAULT_RULE = {
  material: ['木质', '塑料', '硅胶', '不锈钢', '透明'],
  crowd: ['女', '男士', '儿童', '宝宝', '学生'],
  style: ['简约', '可爱', '创意', '新款', '小众'],
  scene: ['送礼', '生日', '夏季', '通勤'],
  function: ['便携', '装饰', '实用', '收纳'],
  price_band: ['平价', '性价比', '低价', '高档'],
  pain_point: ['新手', '懒人', '学生党', '上班族'],
  trend_word: ['2026新款', '爆款', '网红同款', '高级感'],
  patterns: ['seed+crowd', 'style+seed', 'scene+seed', 'function+seed', 'price+seed', 'pain+seed', 'trend+seed']
};

const CATEGORY_RULES = [
  {
    match: /发饰|头饰|发夹|头绳/,
    rule: {
      material: ['珍珠', '水晶', '亚克力', '合金', '布艺', '绒布'],
      crowd: ['女', '儿童', '学生'],
      style: ['国风', '小众', '高级感', '复古', '简约', '可爱'],
      scene: ['送礼', '生日', '通勤', '拍照', '夏季'],
      function: ['防滑', '固定', '装饰'],
      price_band: ['平价', '性价比', '9块9', '白菜价'],
      pain_point: ['懒人', '学生党', '上班族'],
      trend_word: ['2026新款', '爆款', '网红同款', 'ins风', '高级感', '氛围感'],
      patterns: ['material+seed', 'seed+crowd', 'style+seed', 'scene+seed', 'function+seed', 'price+seed', 'pain+seed', 'trend+seed', 'material+seed+crowd']
    }
  },
  {
    match: /饰品|戒指|项链|手链|耳环|耳钉|吊坠|手绳/,
    rule: {
      material: ['玛瑙', '朱砂', '纯银', '和田玉', '钛钢', '水晶', '珍珠', '陶瓷', '木质'],
      crowd: ['女', '男士', '情侣', '学生'],
      style: ['国风', '小众', '高级感', '复古', '简约', '轻奢'],
      scene: ['送礼', '生日', '本命年', '转运', '通勤', '端午'],
      function: ['开口', '可调节', '装饰', '祈福'],
      price_band: ['平价', '性价比', '高档', '轻奢'],
      pain_point: ['新手', '懒人', '上班族'],
      trend_word: ['2026新款', '爆款', '网红同款', 'ins风', '高级感', '氛围感'],
      patterns: ['material+seed', 'seed+crowd', 'crowd+seed', 'style+seed', 'scene+seed', 'function+seed', 'price+seed', 'pain+seed', 'trend+seed', 'material+seed+crowd']
    }
  },
  {
    match: /宠物|逗猫|狗狗|猫咪/,
    rule: {
      material: ['毛绒', '硅胶', '橡胶', '棉绳', 'TPR'],
      crowd: ['猫咪', '狗狗', '幼犬', '小型犬', '大型犬'],
      style: ['可爱', '卡通', '发声', '互动'],
      scene: ['室内', '外出', '训练', '陪伴'],
      function: ['耐咬', '磨牙', '解闷', '自嗨', '发声', '洁齿'],
      price_band: ['平价', '性价比', '9块9', '白菜价'],
      pain_point: ['新手', '懒人', '上班族'],
      trend_word: ['2026新款', '爆款', '网红同款'],
      patterns: ['crowd+seed', 'function+seed', 'style+seed', 'material+seed', 'price+seed', 'pain+seed', 'trend+seed', 'crowd+function+seed']
    }
  },
  {
    match: /家居|收纳|置物|厨房|车载|桌面|小夜灯/,
    rule: {
      material: ['木质', '塑料', '不锈钢', '透明', '硅胶'],
      crowd: ['厨房', '桌面', '车载', '宿舍', '租房'],
      style: ['简约', '免打孔', '壁挂', '多功能', 'ins风'],
      scene: ['厨房', '浴室', '桌面', '宿舍', '车载'],
      function: ['收纳', '防尘', '防滑', '折叠', '置物'],
      price_band: ['平价', '性价比', '9块9', '白菜价'],
      pain_point: ['懒人', '租房党', '学生党', '上班族'],
      trend_word: ['2026新款', '爆款', 'ins风', '高级感', '氛围感'],
      patterns: ['scene+seed', 'function+seed', 'style+seed', 'material+seed', 'price+seed', 'pain+seed', 'trend+seed']
    }
  },
  {
    match: /节日礼品|端午|香包|五彩绳|父亲节|礼物/,
    rule: {
      material: ['玛瑙', '朱砂', '水晶', '木质', '刺绣'],
      crowd: ['女', '儿童', '宝宝', '学生', '情侣', '男士'],
      style: ['国风', '手工', '编织', '复古', '简约'],
      scene: ['端午', '送礼', '伴手礼', '本命年', '转运', '父亲节'],
      function: ['祈福', '装饰', '可调节'],
      price_band: ['平价', '性价比', '高档', '轻奢'],
      pain_point: ['上班族', '宝妈'],
      trend_word: ['2026新款', '爆款', '国风', '高级感'],
      patterns: ['seed+crowd', 'style+seed', 'scene+seed', 'function+seed', 'price+seed', 'pain+seed', 'trend+seed', 'material+seed']
    }
  },
  {
    match: /玩具|益智|水枪|飞盘/,
    rule: {
      material: ['木质', '毛绒', '硅胶', '泡沫', '塑料'],
      crowd: ['儿童', '宝宝', '幼儿', '学生', '8到12岁'],
      style: ['可爱', '卡通', '益智', '新款', '户外'],
      scene: ['生日', '送礼', '室内', '户外', '夏季'],
      function: ['益智', '发声', '互动', '训练', '解压', '戏水'],
      price_band: ['平价', '性价比', '9块9', '白菜价'],
      pain_point: ['宝妈', '新手'],
      trend_word: ['2026新款', '爆款', '网红同款'],
      patterns: ['material+seed', 'seed+crowd', 'style+seed', 'scene+seed', 'function+seed', 'price+seed', 'pain+seed', 'trend+seed']
    }
  }
];

function unique(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function mergeRule(rule) {
  return {
    material: unique(rule.material || DEFAULT_RULE.material),
    crowd: unique(rule.crowd || DEFAULT_RULE.crowd),
    style: unique(rule.style || DEFAULT_RULE.style),
    scene: unique(rule.scene || DEFAULT_RULE.scene),
    function: unique(rule.function || DEFAULT_RULE.function),
    price_band: unique(rule.price_band || DEFAULT_RULE.price_band),
    pain_point: unique(rule.pain_point || DEFAULT_RULE.pain_point),
    trend_word: unique(rule.trend_word || DEFAULT_RULE.trend_word),
    patterns: unique(rule.patterns || DEFAULT_RULE.patterns)
  };
}

function getCategoryRule(seedKeyword, category = '') {
  const target = `${category} ${seedKeyword}`;
  const found = CATEGORY_RULES.find(item => item.match.test(target));
  return mergeRule(found ? found.rule : DEFAULT_RULE);
}

module.exports = { DEFAULT_RULE, CATEGORY_RULES, getCategoryRule };
