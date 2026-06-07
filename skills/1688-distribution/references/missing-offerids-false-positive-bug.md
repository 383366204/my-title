# missingOfferIds 误报 Bug 完整记录

> 最后更新: 2026-06-02

## 时间线

| 日期 | 事件 |
|------|------|
| 2026-06-02 | 第一轮铺货（14商品）4个missing，第二轮（47商品）21个missing |
| 2026-06-02 | 定位根因：`sleep(6000)` 固定等待不足 |
| 2026-06-02 | 实施 Bug A 修复：轮询稳定检测，验证通过（8/8 found） |
| 2026-06-02 | 第三轮铺货（18商品）仍8个missing → 发现 Bug B：分页不翻页 |
| 2026-06-02 | 实施 Bug B 修复：翻页遍历合并文本，验证通过（8/8 found） |
| 2026-06-02 | 修复 CDP 超时（30s→120s），解决翻页+轮询组合超时问题 |
| 2026-06-02 | 大批量铺货（148商品）终端超时 300s — 需分批或用 background 模式 |

## Bug A 详情：等待时间不足

### 复现条件
- 商品数 ≥ ~15 个时稳定复现
- 商品越多越严重（14个→28.6%缺失, 47个→58.3%缺失）

### 修复代码位置
```
文件: /mnt/d/project/my-title/skills/1688-distribution/index.js
函数: confirmCopyRecords()
行号: ~594-620（修复后）
```

### 修复前后对比测试

**测试数据：** 之前全部报 missing 的 8 个 offer ID

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 测试商品数 | 8 | 8 |
| found | 4 (50%) | **8 (100%)** ✅ |
| missing | 4 (50%) | **0 (0%)** ✅ |
| status | partial_confirmed | **confirmed** ✅ |

**测试命令：**
```bash
cd /mnt/d/project/my-title
node bin/cli.js distribute --input-file /tmp/test_fix_distribution.txt --json
```

## Bug B 详情：分页不翻页

### 发现过程
1. Bug A 修复后，用新关键词「夏季通勤珍珠发夹生日送礼」选品铺货
2. 18 个商品提交，返回 10 found + 8 missing
3. 分析 preview 文本发现关键线索：
   - 页面显示 `共 18 条`
   - 有翻页: `一页 1 2 下一页`
   - preview 只包含前 10 条（序号 1-10）
   - foundOfferIds 全部在前 10 条中
   - missingOfferIds 恰好是第 11-18 条（第 2 页）

### 根因确认
```javascript
// 当前代码只读当前页面 DOM
const body = document.body ? document.body.innerText : '';
const foundOfferIds = offerIds.filter(id => body.includes(id));
// body 只含当前可见页 → 第 2 页的 ID 必然匹配不到
```

### 缺失的 8 个 ID（第三轮）
```
723365018514  — 水钻珍珠小巧精致发卡 ¥0.28 月销800
1044413853762 — 法式复古珍珠发夹 ¥10.50 月销10
786537329903  — 新款精致小号抓夹 ¥0.75 月销100
713408514622  — 珍珠水钻气质发夹 ¥0.29 月销200 ⭐复购率86.2%
1027032024879 — 精致小号抓夹(同款不同店) ¥0.29 月销10
863252749098  — 珍珠发梳蝴蝶发卡 ¥3.86 月销30
944488458846  — 法式复古珍珠花朵发夹 ¥3.49 月销50
880906872079  — 合金高级感半扎发夹 ¥0.51 月销10
```

**注意：这 8 个在 1688 上全部正常可访问，且已成功进入逸掌柜复制队列（在第 2 页）。**

### Bug B 修复与验证

**修复代码位置：** `index.js` ~第 612 行，替换单次 `bodyText` 读取为翻页循环

**翻页参数：**
- `MAX_PAGE_TURNS = 10`（最多翻 10 页）
- 翻页等待 `sleep(1000)`（每页等 1 秒）
- 页面间文本用 `\n--- PAGE BREAK ---\n` 分隔

**验证结果：**

| 指标 | Bug B 修复前 | Bug B 修复后 |
|------|-------------|-------------|
| 测试商品数 | 18 (第三轮) | 8 (历史 missing) |
| found | 10 (55.6%) | **8 (100%)** ✅ |
| missing | 8 (44.4%) | **0 (0%)** ✅ |
| status | partial_confirmed | **confirmed** ✅ |
| preview 分隔符 | 无 | `--- PAGE BREAK ---` 可见 |

**测试命令：**
```bash
cd /mnt/d/project/my-title
node bin/cli.js distribute --input-file /tmp/test_bugB_fix.txt --json
```

### CDP 超时问题（Bug B 修复过程中发现）

**现象：** Bug B 首次实施后执行 distribute 报 `CDP timeout: Runtime.evaluate`，exit_code 1

**原因：** 底层 CDP 调用超时硬编码 30s（`index.js` 第 278 行），而轮询（60s）+ 翻页（10s）组合远超此限制

**修复：** 第 278 行 `30000` → `120000`（120 秒）

**迭代过程：**
1. 首次修复：MAX_PAGE_TURNS=20, sleep=2000ms → CDP timeout
2. 二次优化：MAX_PAGE_TURNS=10, sleep=1000ms → 仍 CDP timeout
3. 最终修复：加大 CDP 超时至 120s → ✅ 通过

### 大批量铺货终端超时问题

**现象：** 148 个商品执行 distribute，Hermes terminal timeout=300s 时中断（exit_code 124）

**原因：** 这是 **Hermes terminal 的超时**（默认 300s），不是 CDP 超时。148 个商品 × 每个搜索+检测耗时 ≈ 总时间 > 300s

**应对方案：**
1. **分批提交**：每批 ≤50 个商品，分多次执行
2. **使用 background 模式**：`terminal(command, background=true, notify_on_complete=true)`
3. **增大 terminal timeout**：`terminal(command, timeout=600)` — 最大 600s

## 调试方法论

### 快速判断流程图
```
遇到 missingOfferIds
    │
    ├─ Step 1: 抽样验证 1688 链接
    │   浏览器打开 https://detail.1688.com/offer/<id>.html
    │   ├─ 能打开 → 不是链接问题，往下查
    │   └─ 打不开(404/下架) → 真正失效，报告用户
    │
    ├─ Step 2: 分析 confirmation.preview 文本
    │   ├─ 找 "共 N 条" → 实际成功提交数
    │   ├─ 找 "1 2 下一页" → 是否有分页
    │   ├─ found IDs 是否全在前几条?
    │   └─ missing 数量 ≈ N - 每页条数?
    │       ├─ 是 → Bug B（分页）
    │       └─ 否 → 可能还有其他原因
    │
    └─ Step 3: 给出结论
        明确区分「已证实」vs「推测」，标注验证方法
```

### 用户偏好记录
- **不要对逸掌柜内部行为做无依据猜测。** 用户明确追问"逸掌柜搜索是什么"时，说明之前的表述把推测当成了事实。
- 正确做法：能从返回数据（preview、statusCounts）中直接观察到的事实才作为结论；其余标注为可能原因并给出验证路径。
