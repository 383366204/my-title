'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

/**
 * 本机店铺配置，不保存账号密码或登录凭据。
 * @param {string} file 配置文件位置。
 * @returns {object} 店铺列表、保存、删除及读取方法。
 */
function createDistributionShopStore(file = path.join(process.cwd(), 'data/workflow/distribution-shops.json')) {
  const list = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const write = rows => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };
  const get = id => {
    const shop = list().find(row => row.id === id);
    if (!shop || !shop.enabled) throw Object.assign(new Error('请选择有效且已启用的铺货店铺。'), { code: 'INVALID_SHOP' });
    return shop;
  };
  return {
    list, get,
    save(input = {}) {
      const rows = list();
      const name = String(input.name || '').trim();
      const platformShopName = String(input.platformShopName || '').replace(/\s+/g, ' ').trim();
      const port = Number(input.port ?? 9222);
      if (!name || !platformShopName || name.length > 80 || platformShopName.length > 160) throw new Error('请填写店铺显示名称和铺货平台店铺名称。');
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Chrome 端口必须是 1–65535 的整数。');
      if (input.id && !rows.some(row => row.id === input.id)) throw new Error('店铺配置已不存在，请刷新。');
      if (rows.some(row => row.id !== input.id && row.platformShopName === platformShopName && row.port === port)) throw new Error('同一 Chrome 端口下的店铺已配置，请编辑已有店铺。');
      const shop = { id: input.id || randomUUID(), revision: randomUUID(), name, platformShopName, port, enabled: input.enabled !== false, isDefault: input.isDefault === true };
      if (!shop.enabled) shop.isDefault = false;
      const next = rows.filter(row => row.id !== shop.id).map(row => shop.isDefault ? { ...row, isDefault: false } : row);
      write([...next, shop]);
      return shop;
    },
    remove(id) { write(list().filter(row => row.id !== id)); }
  };
}

module.exports = { createDistributionShopStore };
