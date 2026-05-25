## Context

Iteration 14 正在把 Coordinator 从 workflow action 遥控器收敛为多个 workflow run / agent session 的生命周期管理者、观察者和人工 gate 收件箱。Slice 14.2 已将 outer Codex / Claude Code provider 接入 SDK-first runtime，并把 raw provider 输出保存为 transcript artifact；但当前 Web、timeline 和 daemon 还缺少统一的 agent activity 摘要，只能看到 session completed / failed 这类粗粒度事件。

本轮实现必须继续保持三个边界：

- SDK raw events 只是排查证据，不是 Core 状态机真源。
- Coordinator Agent surface 不应接收 provider raw JSONL、private session path、permission internals 或完整 transcript。
- daemon/watchdog 可以观察 agent lifecycle，但不能因为 provider event、workflow allowed action 或 debug projection 自动推进业务完成、PR/MR、merge 或 workflow action。

## Goals / Non-Goals

**Goals:**

- 在 AgentProvider runtime 内定义 provider event 三层模型：raw artifact、normalized summary、decision signal。
- 为 session completed / failed event 增加窄的 agent activity 摘要，包括 last activity、latest normalized event、provider evidence 和 artifact refs。
- 在 operator task detail / Task Cockpit 中展示 agent activity 摘要，默认不展开完整 transcript。
- 让 daemon/watchdog 使用 last activity / lifecycle signal 做 stalled observation，同时保持业务完成仍由 Coordinator Agent final response、Core tool executor、workflow handoff、PR/MR provider 和 human gate 决定。
- 增加测试，覆盖 raw event artifact、normalized event 白名单、surface 不泄漏 raw event、Web 展示摘要。

**Non-Goals:**

- 不修改 `/Users/hetao/Documents/github/workflow`，不要求 workflow protocol 新增 `agent.state`、`operatorActions` 或 `blocker.owner`。
- 不实现 inner coding agent 的完整 lifecycle ownership；本轮只处理 Coordinator 外层 AgentProvider runtime 的 event normalization。
- 不把 raw provider event 作为 task status、PR readiness、merge readiness、workflow handoff 或 workflow action 的判定依据。
- 不新增 agent-facing tool，不把 Web Task Cockpit 变成 provider transcript 浏览器。
- 不强制引入新的数据库 migration；优先复用 artifact、event payload 和已有 session status / updatedAt。

## Decisions

### Decision 1: raw event artifact 与 transcript 兼容并行

Provider adapter 输出 `rawEvents` 时，runtime 将其写入 `provider-events.jsonl`；如果现有 provider 只产生 transcript，则继续保留 `transcript.jsonl`，并把 provider events artifact ref 作为可选 evidence。这样可以让 SDK-first provider 更清晰地表达 raw stream，同时不破坏 CLI fallback 和既有测试。

替代方案是把 transcript 直接改名为 provider-events，但这会扩大兼容面，并让现有 artifact 引用和历史数据失效。

### Decision 2: normalized event 采用固定白名单

Core 只识别少量 provider-agnostic event kind，例如 `session_started`、`turn_started`、`message_delta`、`tool_started`、`tool_finished`、`permission_requested`、`turn_completed`、`session_completed`、`session_failed`。未知 provider event 只能归一化为 `provider_event` 或被计数汇总，不把完整对象写入 event payload。

这比保存 provider-specific event type 更保守，能避免后续 Codex / Claude SDK schema 变化污染 Core 和 Web。

### Decision 3: decision signal 只保留 lifecycle 摘要

runtime 从 provider result 派生 `agentActivity`：

- `state`: running / completed / failed / stalled / unknown 中的窄状态。
- `lastActivityAt`: raw/normalized event 最新时间或 session updatedAt。
- `latestEvent`: 单条 normalized 摘要。
- `failureKind`: provider failure 时的有限分类。
- `artifactRefs`: provider events、transcript、final response。

这些字段可以进入 operator-only summary 和 event payload；不得直接改变 task 外层状态。业务推进仍来自 Coordinator Agent final response 和 Core tool executor。

### Decision 4: Web 默认展示摘要，debug 只展示引用

Task Cockpit / operator detail 默认展示 provider、session status、implementation mode、permission profile、last activity、latest normalized event 和 final response artifact。完整 provider event 只以 artifact ref 形式出现，不在默认页面内联 JSONL。

这符合 Web Workbench 的定位：帮助开发者管理多个任务，而不是让开发者持续阅读 provider stream。

### Decision 5: daemon 只消费 last activity 做 observation

daemon/watchdog 可以用 `lastActivityAt` 改善 no-progress / stalled observation，但 recovery decision 仍必须走 Core recovery service，且 event stream 不得触发 task completed、PR/MR、merge 或 workflow action。

这保持 daemon 是可靠运行时而不是智能体。

## Risks / Trade-offs

- [Risk] 不同 SDK raw event schema 持续变化，normalized mapper 可能覆盖不完整。→ Mitigation：采用白名单 + unknown 计数，未知事件只作为 artifact 证据保留。
- [Risk] Web 展示 latest event 可能被误解为完成依据。→ Mitigation：文案和数据结构只标记 activity，不给出业务完成判断；完成仍看 workflow handoff / PR/MR / human gate。
- [Risk] 不新增 DB 字段会让 last activity 查询依赖 event payload 或 session updatedAt。→ Mitigation：本轮先以事件和 operator summary 派生，后续若需要更高效查询再单独设计 migration。
- [Risk] provider-events 与 transcript 双 artifact 可能重复。→ Mitigation：只把 provider-events 作为 raw stream 证据，transcript 继续承载兼容 fallback 和 final response 链接；Web 只展示引用摘要。
