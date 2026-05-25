## 1. Core event normalization

- [x] 1.1 定义 provider-agnostic `NormalizedAgentEvent`、`AgentActivitySummary` 和 provider event artifact refs 类型。
- [x] 1.2 将 SDK/CLI provider raw events 写入 `provider-events.jsonl` 或兼容 transcript artifact，并保留 sanitized artifact refs。
- [x] 1.3 实现 raw provider event 到 normalized event 白名单的 mapper，未知 event 只保留计数或短摘要。
- [x] 1.4 在 session completed / failed event payload 中记录 last activity、latest normalized event、failure kind 和 artifact refs。

## 2. Operator summaries and surfaces

- [x] 2.1 扩展 task detail / execution summary 的 recent agent sessions，展示 agent activity 摘要。
- [x] 2.2 确认 Coordinator Surface 只暴露 provider、session status、短 activity 摘要和 artifact refs，不泄漏 raw event 或 permission internals。
- [x] 2.3 让 daemon/watchdog 使用 last activity / lifecycle signal 做 stalled observation，但不让 provider event 驱动业务完成或 workflow action。

## 3. Web presentation

- [x] 3.1 在 Task Cockpit / operator detail 中展示 agent activity 摘要、latest normalized event 和 final response artifact。
- [x] 3.2 确认 Web 默认不内联完整 provider transcript / raw JSONL，Action Inbox 不因 agent activity 自动新增 needs-me item。

## 4. Tests and validation

- [x] 4.1 增加 core tests 覆盖 provider event artifact、normalized event 白名单、agent activity payload 和 failure signal。
- [x] 4.2 增加 surface / summary tests 覆盖 raw event 不进入 Coordinator Surface 或 operator summary 的 raw 字段。
- [x] 4.3 增加 Web tests 或 typecheck/build 覆盖 agent activity 摘要展示。
- [x] 4.4 运行 OpenSpec validate、相关 Vitest、typecheck 和 `pnpm --filter @coordinator/core build`。
- [x] 4.5 使用 subagent review 检查 docs 边界、过度设计、分层污染、raw event 是否被误用为状态机或 Surface 真相。
