'use strict';

// 在平台页面内执行，仅使用已有的店铺复选框，不按位置猜测目标。
function shopSelectionInPage(names, apply) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const rows = Array.from(document.querySelectorAll('.shopItem label.el-checkbox')).map(label => {
    const legacyName = normalize(label.querySelector('.el-checkbox__label')?.textContent);
    // 新版店名在复选框旁的独立标题中，只取文字节点，排除“主店铺”等徽标。
    const heading = label.closest?.('.shopItem')?.querySelector(':scope > .flx-align-center.f15');
    const headingName = heading ? normalize(Array.from(heading.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join('')) : '';
    return { label, input: label.querySelector('input[type="checkbox"]'), name: headingName || legacyName || normalize(label.textContent) };
  });
  const matches = [];
  for (const name of names) {
    const found = rows.filter(row => row.name === normalize(name));
    if (found.length !== 1) {
      const available = rows.map(row => row.name).filter(Boolean);
      return { ok: false, reason: `${name}：${found.length ? '目标店铺名称重复，无法安全选择' : available.length ? `当前页面未找到该店铺；已读取店铺：${available.join('、')}。请核对配置与登录账号` : '尚未读取到店铺列表，请等待页面加载完成后重新检查'}` };
    }
    if (found[0].input?.disabled || found[0].label.classList.contains('is-disabled')) return { ok: false, reason: `${name}：目标店铺不可用，请检查授权或套餐状态` };
    matches.push(found[0]);
  }
  if (apply === 'available') return { ok: true, names: matches.map(row => row.name) };
  const checked = row => row.input ? row.input.checked : row.label.classList.contains('is-checked');
  if (apply) {
    for (const row of rows) {
      if (checked(row) !== matches.includes(row)) row.label.click();
    }
    return { ok: true, applied: true };
  }
  const selected = rows.filter(checked);
  return { ok: selected.length === matches.length && matches.every(row => selected.includes(row)), selected: selected.map(row => row.name), reason: '目标店铺勾选状态不一致，已停止提交' };
}

/**
 * 设置或核对目标店铺集合；无法确认时禁止继续提交。
 * @param {object} client 页面客户端。
 * @param {object} shop 已保存的店铺配置快照。
 * @param {boolean|string} apply 是否调整复选框，available 仅检查可用性。
 * @returns {Promise<object>} 核对结果。
 */
async function ensureSelectedShop(client, shop, apply = false) {
  const shops = Array.isArray(shop) ? shop : [shop];
  if (!shops.length || shops.some(row => !row?.platformShopName)) throw new Error('缺少目标店铺名称');
  const result = await client.evaluate(`(${shopSelectionInPage.toString()})(${JSON.stringify(shops.map(row => row.platformShopName))}, ${JSON.stringify(apply)})`);
  if (!result?.ok) throw new Error(result?.reason || '无法核对目标店铺');
  if (apply === true) return ensureSelectedShop(client, shop, false);
  return result;
}

/**
 * 在同一次页面执行中核对店铺并点击提交，避免核对与点击之间切换店铺。
 * @param {object} client 页面客户端。
 * @param {object} shop 已确认的目标店铺。
 * @returns {Promise<object>} 点击结果。
 */
async function submitSelectedShop(client, shop, modeText) {
  const shops = Array.isArray(shop) ? shop : [shop];
  const result = await client.evaluate(`(() => {
    const checked = (${shopSelectionInPage.toString()})(${JSON.stringify(shops.map(row => row.platformShopName))}, false);
    if (!checked.ok) return checked;
    const modeText = ${JSON.stringify(modeText || '')};
    if (modeText) {
      const selected = Array.from(document.querySelectorAll('label')).filter(label => label.querySelector('input[type="radio"]:checked'));
      if (!selected.some(label => label.textContent.trim() === modeText)) return { ok: false, reason: '商品分配方式发生变化，已停止提交' };
    }
    return window.__ecom1688.clickExact('开始批量复制', 'button');
  })()`);
  if (!result?.ok) throw new Error(result?.reason || '无法向目标店铺提交');
  return result;
}

module.exports = { ensureSelectedShop, submitSelectedShop };
