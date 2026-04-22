# Path 8: --peer-titles 手动提供测试

## 测试条件
- 使用 `--peer-titles` 参数提供手动同行标题
- 标题: "纯银项链女款高级感,925银项链小众设计,纯银锁骨链ins风"
- 期望跳过图片搜索，直接使用提供的标题

## 测试结果
✅ **PASS** - 降级路径工作正常

## 观察到的行为
1. **跳过图片搜索**: 日志中没有出现"以图搜图"相关输出
2. **直接使用peerTitles**: 代码路径正确进入 `if (peerTitles && peerTitles.length > 0)` 分支
3. **GLM正常生成标题**: 生成13个标题，22个商品
4. **程序正常完成**: Exit code 0

## 关键日志对比
**无 --peer-titles 时**（Path 1）:
```
🔎 第三步：根据条件进行图像搜索或文字搜索（串行）...
⚠️  taobao-native CLI 未安装...
```

**有 --peer-titles 时**（Path 8）:
```
🔎 第三步：根据条件进行图像搜索或文字搜索（串行）...
  过滤后剩余 22 个商品
n✍️  尝试 GLM selectAndGenerate 以输出更多字段...
```

注意：没有看到图片搜索相关的日志输出，说明成功跳过！

## 代码验证
根据 `src/index.js` 第 103-104 行：
```javascript
if (peerTitles && peerTitles.length > 0) {
  taobaoTitles = peerTitles;
  // 跳过了图片搜索逻辑
}
```

## 验证点
- [x] --peer-titles 参数正确解析
- [x] 跳过图片搜索流程
- [x] 直接使用提供的同行标题
- [x] GLM正常生成结果
- [x] 程序不崩溃（exit code 0）

## 时间戳
2026-04-22
