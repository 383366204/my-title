const DEFAULT_RULE = {
  material: ['木质', '塑料', '硅胶'],
  crowd: ['女', '男士', '儿童', '学生'],
  style: ['简约', '可爱', '创意', '新款'],
  scene: ['送礼', '生日', '夏季'],
  function: ['便携', '装饰', '实用'],
  patterns: ['seed+crowd', 'style+seed', 'scene+seed', 'function+seed']
};

const CATEGORY_RULES = [
  {
    match: /发饰/,
    rule: {
      material: ['珍珠', '水晶', '亚克力', '合金', '布艺', '绒布'],
      crowd: ['女', '儿童', '学生'],
      style: ['国风', '小众', '高级感', '复古', '简约', '可爱'],
      scene: ['送礼', '生日', '通勤', '拍照'],
      function: ['防滑', '固定', '装饰'],
      patterns: ['material+seed', 'seed+crowd', 'style+seed', 'scene+seed', 'function+seed', 'material+seed+crowd']
    }
  },
  {
    match: /饰品/,
    rule: {
      material: ['玛瑙', '朱砂', '纯银', '和田玉', '钛钢', '水晶', '珍珠', '陶瓷', '木质'],
      crowd: ['女', '男士', '情侣'],
      style: ['国风', '小众', '高级感', '复古', '简约', '轻奢'],
      scene: ['送礼', '生日', '本命年', '转运', '通勤'],
      function: ['开口', '可调节', '装饰'],
      patterns: ['material+seed', 'seed+crowd', 'style+seed', 'scene+seed', 'function+seed', 'material+seed+crowd']
    }
  },
  {
    match: /宠物/,
    rule: {
      material: ['毛绒', '硅胶', '橡胶', '棉绳'],
      crowd: ['猫咪', '狗狗', '幼犬', '小型犬', '大型犬'],
      style: ['可爱', '卡通', '发声', '互动'],
      scene: ['室内', '外出', '训练', '陪伴'],
      function: ['耐咬', '磨牙', '解闷', '自嗨', '发声', '洁齿'],
      patterns: ['crowd+seed', 'function+seed', 'style+seed', 'material+seed', 'crowd+function+seed']
    }
  },
  {
    match: /家居|车品/,
    rule: {
      material: ['木质', '塑料', '不锈钢', '透明'],
      crowd: ['厨房', '桌面', '车载', '宿舍'],
      style: ['简约', '免打孔', '壁挂', '多功能'],
      scene: ['厨房', '浴室', '桌面', '宿舍', '车载'],
      function: ['收纳', '防尘', '防滑', '折叠', '置物'],
      patterns: ['scene+seed', 'function+seed', 'style+seed', 'material+seed']
    }
  },
  {
    match: /节日礼品/,
    rule: {
      material: ['玛瑙', '朱砂', '水晶', '木质'],
      crowd: ['女', '儿童', '宝宝', '学生', '情侣'],
      style: ['国风', '手工', '编织', '复古'],
      scene: ['端午', '送礼', '伴手礼', '本命年', '转运'],
      function: ['祈福', '装饰', '可调节'],
      patterns: ['seed+crowd', 'style+seed', 'scene+seed', 'function+seed', 'material+seed']
    }
  },
  {
    match: /玩具/,
    rule: {
      material: ['木质', '毛绒', '硅胶'],
      crowd: ['儿童', '宝宝', '幼儿', '学生'],
      style: ['可爱', '卡通', '益智', '新款'],
      scene: ['生日', '送礼', '室内', '户外'],
      function: ['益智', '发声', '互动', '训练', '解压'],
      patterns: ['material+seed', 'seed+crowd', 'style+seed', 'scene+seed', 'function+seed']
    }
  }
];

function mergeRule(rule) {
  return {
    material: rule.material || DEFAULT_RULE.material,
    crowd: rule.crowd || DEFAULT_RULE.crowd,
    style: rule.style || DEFAULT_RULE.style,
    scene: rule.scene || DEFAULT_RULE.scene,
    function: rule.function || DEFAULT_RULE.function,
    patterns: rule.patterns || DEFAULT_RULE.patterns
  };
}

function getCategoryRule(seedKeyword, category = '') {
  const target = `${category} ${seedKeyword}`;
  const found = CATEGORY_RULES.find(item => item.match.test(target));
  return mergeRule(found ? found.rule : DEFAULT_RULE);
}

module.exports = { DEFAULT_RULE, CATEGORY_RULES, getCategoryRule };
