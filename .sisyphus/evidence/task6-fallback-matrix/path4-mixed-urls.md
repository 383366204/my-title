# Path 4: 混合情况测试（部分有效/无效URL）

## 测试条件
- 4个商品混合URL格式
- invalid1: 非URL格式字符串
- invalid2: 空URL
- valid1: 有效格式URL（http开头）
- invalid3: ftp协议URL

## 测试结果
✅ **PASS** - 降级路径工作正常

## 观察到的行为
1. **URL验证正确**: 3个无效URL被跳过
   - `[1] ID:invalid1 - URL不以http开头`
   - `[2] ID:invalid2 - 无图片URL`
   - `[4] ID:invalid3 - URL不以http开头`
2. **有效URL尝试搜索**: 1个有效格式URL进入image_search
3. **image_search失败**: 由于CLI问题，搜索失败
4. **返回默认值**: 全部 hasMatch=false

## 统计数据
```
总商品数: 4
有效商品: 1
跳过商品: 3
匹配成功: 0
```

## 结果分布
| 商品ID | URL状态 | hasMatch | peerTitles |
|--------|---------|----------|------------|
| invalid1 | INVALID_FORMAT | false | 0 |
| invalid2 | EMPTY | false | 0 |
| valid1 | VALID_FORMAT | false | 0 |
| invalid3 | INVALID_FORMAT | false | 0 |

## 验证点
- [x] URL格式验证正确区分有效/无效
- [x] 无效URL被跳过并记录日志
- [x] 有效URL尝试搜索
- [x] 失败时返回默认值
- [x] 程序不崩溃（exit code 0）

## 时间戳
2026-04-22
