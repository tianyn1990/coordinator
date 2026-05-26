## 1. 文档和契约

- [x] 1.1 更新 `docs/` 相关设计文档，统一 SDK 输出与 workflow protocol 状态的职责边界。
- [x] 1.2 更新 `docs/roadmap.md` 当前进度和新增切片计划。
- [x] 1.3 校验 OpenSpec proposal/design/specs/tasks。

## 2. Core / API

- [x] 2.1 增加 workflow gate evidence 派生模块，基于 workflow run、latest workflow projection、inner agent session final response 和 artifact refs 生成 operator-only evidence packet。
- [x] 2.2 在 Core operator workflow action helper 中校验 gate evidence，缺少 coding agent 可见依据时拒绝盲确认。
- [x] 2.3 增加 API `GET /workflow-runs/:id/gate-evidence`，返回窄 evidence projection。
- [x] 2.4 补充 Core/API 单测，覆盖 ready/missing evidence、Web/API 拒绝盲确认、非 operator-facing action 仍拒绝。

## 3. Web

- [x] 3.1 Web V2 Focus Drawer 查询并缓存当前 workflow run gate evidence。
- [x] 3.2 Workflow Action Panel 展示 primary message、protocol facts、artifact refs 和 warnings，并在 `canSubmit=false` 时禁用确认按钮。
- [x] 3.3 补充 Web model/component 测试，覆盖 ready evidence 与 missing evidence 状态。

## 4. 验证、Review、归档

- [x] 4.1 运行 OpenSpec validate、相关单测、typecheck 和必要 package build。
- [x] 4.2 使用独立 subagent review，明确检查 docs 总体设计、是否过度设计、是否污染 Core/Daemon/Workflow protocol/AgentProvider/Web 分层、是否错误让 daemon/outer Agent 自动执行 workflow action、是否把 raw provider events 或 hidden reasoning 变成新状态机。
- [x] 4.3 修复 review 问题后归档 OpenSpec change。
- [x] 4.4 提交本轮文档和代码改动。
