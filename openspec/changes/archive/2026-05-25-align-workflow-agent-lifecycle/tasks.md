## 1. Core / API

- [x] 1.1 梳理现有 workflow action helper、API endpoint、projection 提取和 Web Action Panel 触发路径。
- [x] 1.2 在 Core 中增加 workflow action classification helper，并覆盖 operator-facing、agent/internal、unknown 三类。
- [x] 1.3 修改 operator workflow action helper，执行前校验 action classification，拒绝 agent/internal 和 unknown action。
- [x] 1.4 确认 API `POST /workflow-runs/:id/actions` 继续只调用 Core helper，不直接拼 workflow CLI。

## 2. Web

- [x] 2.1 修改 Task Cockpit Workflow Action Panel，只展示 operator-facing workflow gate。
- [x] 2.2 将 `materialize-change <change-id>`、unknown action 和 agent/internal action input hint 移入 Workflow Lens debug/detail 展示，不进入 Action Inbox / needs-me。
- [x] 2.3 调整 Run Until Blocked banner 和停止原因展示，区分 observing、waiting operator gate、handoff ready 和 operator attention。

## 3. Tests

- [x] 3.1 增加 Core tests，覆盖 `freeze-requirements` / `approve-planning-dossier` 可执行，`materialize-change` 和 unknown action 被拒绝。
- [x] 3.2 增加 Web tests，覆盖 operator-facing action 显示，`materialize-change` 不显示输入框或 needs-me。
- [x] 3.3 增加或更新 daemon/run-until-blocked tests，确认 daemon/Web 不因 agent/internal allowedActions 自动执行 workflow action或制造 operator blocker。

## 4. 验证、Review 与收尾

- [x] 4.1 运行相关 tests、typecheck、Core/Web build 和 `openspec validate align-workflow-agent-lifecycle --strict`。
- [x] 4.2 使用独立 subagent review，检查 docs 总体设计心智、是否过度设计、是否污染 Core/Daemon/Workflow protocol/AgentProvider 分层、是否错误让 daemon 或 outer Agent 自动执行 workflow action。
- [x] 4.3 修复 must-fix 后归档 OpenSpec change，更新 `docs/roadmap.md`，提交本轮改动。
