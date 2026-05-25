## Context

当前 `AgentProvider` interface 已经把 outer Coordinator Agent session 与 Core 状态机隔离开：Core 生成 Coordinator Surface、写 session artifacts、创建 operation/lock、调用 provider、保存 transcript/final response，再由 daemon 解析最终回复中的最多一个 `coordinator-tool` 请求。`CodexProvider` 和 `ClaudeCodeProvider` 目前直接拼 CLI 参数，这能跑通 P0，但长期难以维护 provider session、权限、事件、取消和 resume 语义。

本轮继续遵守既有分层：`AgentProvider` 是执行适配层，不是 Core 状态机；outer Coordinator Agent 是 decision-only；provider cwd 必须固定到 sessionRoot；SDK raw events、provider 私有 session 文件和完整 JSONL transcript 不能进入 Coordinator Surface 或 agent tool 参数。本轮不修改 workflow 工程，不改 workflow protocol，也不改 inner coding agent ownership。

## Goals / Non-Goals

**Goals:**

- 为 Codex 和 Claude Code 增加 SDK-first adapter 主路径。
- 保留现有 CLI subprocess 作为 compatibility fallback。
- 统一 provider result 中的 session id、provider version、permission profile、raw event artifact 和 transcript 写入。
- 用 tests 锁住 cwd、权限、fallback、raw event 不进入 Surface/状态机和 final response 行为。

**Non-Goals:**

- 不实现完整 streaming Web 展示；event normalization 留给 Slice 14.3。
- 不新增 Coordinator Agent tools，不改变 Core tool executor。
- 不把 SDK private session path、permission object 或 raw JSONL 作为 Core 真相源。
- 不改造 workflow inner agent runtime，不让 daemon 自动执行 workflow action。
- 不要求真实 provider auth 可用；真实 SDK 不可用时必须受控 fallback 或 unavailable。

## Decisions

### 1. SDK-first adapter 仍实现现有 `AgentProvider` interface

保留 `AgentProvider.run(input): AgentProviderRunResult` 的同步外观，内部 provider 可调用 SDK 的 async/stream API 并收敛为 final response。这样可以先替换 provider integration，不扩大 Core/daemon/API 调用面。

替代方案是把整个 runtime 改成 async streaming。该方案更适合后续 agent lifecycle 观察，但会同时改 daemon、API 和 tests，范围过大；本轮只为后续事件归一化留下 artifact 和 result 字段。

### 2. CLI fallback 是 provider 内部 compatibility path

`CodexProvider` 和 `ClaudeCodeProvider` 默认优先尝试 SDK adapter；如果 SDK 模块 unavailable、auth/runtime 不可用或调用方显式配置 fallback，则走现有 CLI adapter。fallback 仍必须使用最小权限、sessionRoot cwd、prompt stdin 和窄参数。

不采用“SDK 和 CLI 分成两个 provider id”的方案，因为业务层不应关心 provider implementation mode；Core 只需要知道 provider 是 `codex` 或 `claude-code`。

### 3. raw provider events 只进入 artifact/transcript

SDK streaming event 会原样写入 `transcript.jsonl` 或独立 `provider-events.jsonl` 字段引用；Core event payload 只记录 provider id、implementation mode、permission profile、provider session id、final response preview 和 artifact refs。这样为 Slice 14.3 的 normalized events 留证据，同时避免 raw SDK event 成为隐式状态机。

### 4. SDK 调用必须显式固定 cwd 与权限

Codex outer session 使用 sessionRoot、read-only sandbox、never approval；Claude outer session 使用 sessionRoot、`dontAsk` permission mode 和空/最小 tools。即使 SDK 内部 spawn CLI，Coordinator 也不再手写全部易变参数作为主路径。

## Risks / Trade-offs

- [Risk] SDK API 仍可能变化，或本地缺少 auth/CLI binary。→ 通过 dependency pin、动态 import error classification 和 CLI fallback 降低风险；真实 smoke 缺 auth 时返回 provider unavailable，不静默扩大权限。
- [Risk] raw SDK event 过大或包含敏感字段。→ 本轮只写 artifact，不进入 Surface；后续 Slice 14.3 再定义 normalization 白名单和 redaction。
- [Risk] 为同步 interface 包装 async SDK 会增加实现复杂度。→ 先把 SDK 调用封装到独立 adapter runner，tests 使用 fake SDK runner 覆盖契约；后续可在 runtime async 化时替换外层。
- [Risk] fallback 被误用为长期主路径。→ Provider result 和 transcript 记录 implementation mode，tests 锁住 SDK-first 默认选择。
