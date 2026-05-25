## Why

Slice 14.2 已经把 Codex / Claude Code outer provider 收敛到 SDK-first runtime，并保存了 raw transcript artifact；下一步需要把这些 provider 输出分层为可审计证据、operator 可读摘要和极少 lifecycle signal。这样 Web 和 daemon 能观察 agent 是否仍在运行、最近是否有活动、最后发生了什么，同时不把 SDK raw JSONL 变成 Core 状态机或 Coordinator Agent 的新输入。

## What Changes

- 为 AgentProvider runtime 增加 normalized agent event 模型，将 provider raw events 归一化为白名单摘要，例如 session_started、message_delta、tool_started、tool_finished、permission_requested、turn_completed、session_failed。
- 将 raw provider events 明确写入 `provider-events.jsonl` 或兼容 `transcript.jsonl` artifact；timeline/event payload 只保存 normalized 摘要、artifact ref、last activity 与 failure kind 等窄字段。
- 为 operator task detail / Task Cockpit 增加 agent activity 摘要：provider、session status、implementation mode、permission profile、last activity、latest normalized event、final response artifact。
- 让 daemon/watchdog 在探活和 stalled observation 中使用 agent lifecycle signal，但不得让 normalized/raw event 直接驱动 task done、PR readiness、merge、workflow handoff 或 workflow action。
- 保持 Coordinator Surface 和 agent tools 边界：raw provider event、provider private session 文件、permission internals、完整 JSONL 不进入 agent-facing surface。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `agent-provider-runtime`: 增加 normalized agent events、provider event artifact、last activity / failure signal 的 runtime 契约。
- `observability`: 增加 agent event 三层模型进入 timeline/Web 摘要的契约。
- `web-human-review-surface`: 增加 Task Cockpit / operator detail 中 agent activity 摘要展示契约。
- `daemon-runtime`: 增加 daemon/watchdog 只把 lifecycle signal 用作探活和 recovery observation 的契约。
- `coordinator-surface`: 明确 agent-facing surface 不得暴露 raw provider events、完整 transcript 或 provider private/permission internals。

## Impact

- 影响 `packages/core` 中 AgentProvider result、session artifact 写入、event payload、task detail/execution summary 和 surface 构建。
- 影响 `apps/api` 暴露的 task detail / agent session operator summary，但不新增 agent-facing tool。
- 影响 `apps/web` Task Cockpit / detail 展示 agent activity 摘要。
- 影响 daemon watchdog / recovery observation 的 agent session 摘要使用方式。
- 不修改 `/Users/hetao/Documents/github/workflow`，不修改 workflow protocol，不新增 SDK 依赖，不扩大 Web workflow action loop。
