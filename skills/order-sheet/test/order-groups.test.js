'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  getProductKey,
  normalizeOrderProduct,
  autoGroupOrderProducts,
  rowsToOrderGroups,
  validateOrderGroups,
  assertValidOrderGroups,
  normalizeOrderGroups,
  flattenOrderGroups
} = require('../src/order-groups');

describe('order-groups module', () => {
  it('getProductKey correctly extracts unique product key', () => {
    assert.equal(getProductKey({ itemId: '748392019283' }), '748392019283');
    assert.equal(getProductKey({ productUrl: 'https://item.taobao.com/item.htm?id=123456' }), '123456');
    assert.equal(getProductKey({ sourceKey: 'item_abc' }), 'item_abc');
    assert.equal(getProductKey({ title: '测试商品标题' }), '测试商品标题');
  });

  it('normalizes single order product item with role and defaults', () => {
    const item = {
      itemId: '123456',
      title: '高档真丝连衣裙',
      imageUrl: 'https://img.alicdn.com/test.jpg',
      orderAmount: 199.9,
      storeName: '某某旗舰店'
    };
    const normalizedMain = normalizeOrderProduct(item, 'main');
    assert.equal(normalizedMain.itemId, '123456');
    assert.equal(normalizedMain.title, '高档真丝连衣裙');
    assert.equal(normalizedMain.role, 'main');
    assert.equal(normalizedMain.orderAmount, 199.9);
    assert.equal(normalizedMain.storeName, '某某旗舰店');

    const normalizedSub = normalizeOrderProduct(item, 'sub');
    assert.equal(normalizedSub.role, 'sub');
  });

  it('autoGroupOrderProducts performs 1-drag-2 grouping with tail group handling', () => {
    const products = [
      { itemId: 'p1', title: '商品 1', orderAmount: 100 },
      { itemId: 'p2', title: '商品 2', orderAmount: 50 },
      { itemId: 'p3', title: '商品 3', orderAmount: 30 },
      { itemId: 'p4', title: '商品 4', orderAmount: 120 },
      { itemId: 'p5', title: '商品 5', orderAmount: 60 },
      { itemId: 'p6', title: '商品 6', orderAmount: 40 },
      { itemId: 'p7', title: '商品 7', orderAmount: 200 }
    ];

    // 1-drag-2 means 1 main + 2 sub = groupSize of 3.
    // 7 products: Group 1 (3 items), Group 2 (3 items), Group 3 (1 item - tail group).
    const groups = autoGroupOrderProducts(products, { dragCount: 2, groupPrefix: '商品组 ' });
    assert.equal(groups.length, 3);

    // Group 1
    assert.equal(groups[0].groupName, '商品组 1');
    assert.equal(groups[0].mainProduct.itemId, 'p1');
    assert.equal(groups[0].mainProduct.role, 'main');
    assert.equal(groups[0].subProducts.length, 2);
    assert.equal(groups[0].subProducts[0].itemId, 'p2');
    assert.equal(groups[0].subProducts[0].role, 'sub');
    assert.equal(groups[0].subProducts[1].itemId, 'p3');
    assert.equal(groups[0].subProducts[1].role, 'sub');
    assert.equal(groups[0].totalCount, 3);

    // Group 2
    assert.equal(groups[1].groupName, '商品组 2');
    assert.equal(groups[1].mainProduct.itemId, 'p4');
    assert.equal(groups[1].subProducts.length, 2);
    assert.equal(groups[1].subProducts[0].itemId, 'p5');
    assert.equal(groups[1].subProducts[1].role, 'sub');
    assert.equal(groups[1].subProducts[1].itemId, 'p6');

    // Group 3 (Tail group: 1 main + 0 sub)
    assert.equal(groups[2].groupName, '商品组 3');
    assert.equal(groups[2].mainProduct.itemId, 'p7');
    assert.equal(groups[2].subProducts.length, 0);
    assert.equal(groups[2].totalCount, 1);
  });

  it('rowsToOrderGroups converts legacy flat rows to 1-drag-0 single-product groups', () => {
    const rows = [
      { itemId: 'r1', title: 'Row 1', orderAmount: 88 },
      { itemId: 'r2', title: 'Row 2', orderAmount: 99 }
    ];
    const groups = rowsToOrderGroups(rows);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].mainProduct.itemId, 'r1');
    assert.equal(groups[0].mainProduct.role, 'main');
    assert.deepEqual(groups[0].subProducts, []);
    assert.equal(groups[1].mainProduct.itemId, 'r2');
  });

  it('validateOrderGroups rejects intra-group duplicates', () => {
    const duplicateInsideGroup = [
      {
        groupId: 'g1',
        groupName: '组 1',
        mainProduct: { itemId: 'item_100', title: '主品' },
        subProducts: [
          { itemId: 'item_200', title: '副品 1' },
          { itemId: 'item_100', title: '主品重复出现在副品' }
        ]
      }
    ];
    const result = validateOrderGroups(duplicateInsideGroup);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /组内存在重复商品/);

    assert.throws(() => {
      assertValidOrderGroups(duplicateInsideGroup);
    }, /组内存在重复商品/);
  });

  it('validateOrderGroups allows cross-group item reuse', () => {
    const crossGroupReuse = [
      {
        groupId: 'g1',
        groupName: '组 1',
        mainProduct: { itemId: 'item_100', title: '商品 A（组1主品）' },
        subProducts: [
          { itemId: 'item_200', title: '商品 B（组1副品）' }
        ]
      },
      {
        groupId: 'g2',
        groupName: '组 2',
        mainProduct: { itemId: 'item_300', title: '商品 C（组2主品）' },
        subProducts: [
          { itemId: 'item_100', title: '商品 A（组2副品 - 允许跨组复用）' }
        ]
      }
    ];
    const result = validateOrderGroups(crossGroupReuse);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('validateOrderGroups rejects groups with empty product titles', () => {
    const emptyTitleGroup = [
      {
        groupId: 'g1',
        groupName: '组 1',
        mainProduct: { itemId: 'item_100', title: '' },
        subProducts: []
      }
    ];
    const result = validateOrderGroups(emptyTitleGroup);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /缺少商品标题/);
  });

  it('flattenOrderGroups flattens groups with group metadata', () => {
    const groups = [
      {
        groupId: 'group-1',
        groupName: '测试分组 1',
        mainProduct: { itemId: 'm1', title: '主品 1', orderAmount: 100 },
        subProducts: [
          { itemId: 's1', title: '副品 1', orderAmount: 50 },
          { itemId: 's2', title: '副品 2', orderAmount: 30 }
        ]
      },
      {
        groupId: 'group-2',
        groupName: '测试分组 2',
        mainProduct: { itemId: 'm2', title: '主品 2', orderAmount: 200 },
        subProducts: []
      }
    ];

    const flattened = flattenOrderGroups(groups);
    assert.equal(flattened.length, 4);

    assert.equal(flattened[0].itemId, 'm1');
    assert.equal(flattened[0].groupId, 'group-1');
    assert.equal(flattened[0].groupName, '测试分组 1');
    assert.equal(flattened[0].role, 'main');
    assert.equal(flattened[0].groupIndex, 1);
    assert.equal(flattened[0].itemIndexInGroup, 1);

    assert.equal(flattened[1].itemId, 's1');
    assert.equal(flattened[1].role, 'sub');
    assert.equal(flattened[1].itemIndexInGroup, 2);

    assert.equal(flattened[2].itemId, 's2');
    assert.equal(flattened[2].role, 'sub');
    assert.equal(flattened[2].itemIndexInGroup, 3);

    assert.equal(flattened[3].itemId, 'm2');
    assert.equal(flattened[3].groupId, 'group-2');
    assert.equal(flattened[3].role, 'main');
    assert.equal(flattened[3].groupIndex, 2);
    assert.equal(flattened[3].itemIndexInGroup, 1);
  });

  it('clarifies decoupling of rowSpan (Excel formatting) and dragCount (1-drag-N grouping)', () => {
    // rowSpan is an Excel row merge height / spacing parameter (e.g. 3 rows height per item on sheet).
    // dragCount is business grouping: 1 main + dragCount subs per order group.
    const rowSpan = 3; // Excel layout param
    const dragCount = 2; // Business 1-drag-2 param

    const items = [
      { itemId: '101', title: 'Item 1' },
      { itemId: '102', title: 'Item 2' },
      { itemId: '103', title: 'Item 3' }
    ];

    const groups = autoGroupOrderProducts(items, { dragCount });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].subProducts.length, 2);
    // rowSpan is independent of group count / size
    assert.equal(rowSpan, 3);
  });
});
