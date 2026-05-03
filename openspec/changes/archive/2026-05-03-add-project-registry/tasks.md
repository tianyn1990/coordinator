## 1. 数据模型

- [x] 1.1 为 `projects` 表补充 registry 相关字段或等价表结构。
- [x] 1.2 为 project registry 增加 repository 查询和 service 入口。

## 2. 注册流程

- [x] 2.1 实现 repo path、remote URL、GitHub/GitLab 识别和 manual override。
- [x] 2.2 实现 remote HEAD 检测与默认分支显式确认。
- [x] 2.3 实现 workflow launcher 和默认 agent/provider 配置保存。

## 3. CLI / API

- [x] 3.1 实现 CLI 注册工程入口和工程状态查看入口。
- [x] 3.2 实现 API 注册工程入口和工程状态查看入口。

## 4. 测试与验证

- [x] 4.1 测试 GitHub/GitLab 自动识别和手动选择。
- [x] 4.2 测试默认分支显式确认和失败阻塞。
- [x] 4.3 测试 degraded mode 保存和 blocker 暴露。
- [x] 4.4 运行 OpenSpec validate、类型检查、测试和构建。
