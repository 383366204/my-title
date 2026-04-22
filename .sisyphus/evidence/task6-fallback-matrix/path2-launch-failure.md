# Path 2: taobao-native 启动失败降级测试

## 测试条件
- 淘宝桌面版进程未运行
- 模拟启动后 image_search 调用失败场景

## 测试结果
✅ **PASS** - 降级路径工作正常

## 观察到的行为
1. **启动成功但执行失败**：`launchTaobaoDesktop()` 返回 true（进程启动了）
2. **image_search 调用失败**：所有商品都显示 `⚠️ image_search 调用失败，API/CLI 异常`
3. **返回默认值**：每个失败的商品返回 `hasMatch: false, peerTitles: []`
4. **不崩溃**：程序继续处理所有商品（19个）
5. **最终降级**：当没有同行标题时，程序继续用 GLM 生成标题

## 关键日志
```
⚠️ image_search 调用失败，API/CLI 异常: Command failed: cmd.exe /c "..."
ϵͳ�Ҳ���ָ����·����  (系统找不到指定的路径)
```

## 验证点
- [x] image_search 失败时不崩溃
- [x] 返回 hasMatch: false 默认值
- [x] 继续处理后续商品
- [x] 程序最终正常退出（exit code 0）

## 时间戳
2026-04-22
