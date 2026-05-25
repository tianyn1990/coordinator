## Why

当前 `CodexProvider` 和 `ClaudeCodeProvider` 直接拼接 CLI 参数启动 outer Coordinator Agent，长期会被 provider CLI 参数变化、权限语义变化和事件输出格式变化打穿。官方 SDK 已经提供更稳定的 session、cwd、权限、stream event、cancel/resume 封装，本轮需要把主路径升级为 SDK-first，同时保留 CLI compatibility fallback。

## What Changes

- 将 outer `CodexProvider` / `ClaudeCodeProvider` 的主实现调整为 SDK-first adapter。
- 保留现有 CLI subprocess adapter 作为 compatibility fallback，并通过受控配置或 SDK unavailable 分支使用。
- 统一 provider run 结果中的 session id、provider version、permission profile、raw provider event artifact 和 final response。
- 将 raw SDK events 只写入 session transcript / provider-events artifact，不进入 Coordinator Surface、Core 状态机或 agent tool 参数。
- 继续保证 outer Coordinator Agent 是 decision-only：provider cwd 固定 sessionRoot，权限最小，不直接指向 project repo 或 workspace repo。
- 不修改 `/Users/hetao/Documents/github/workflow`，不修改 `workflow protocol`，不改变 inner coding agent ownership。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `agent-provider-runtime`: 将 provider runtime 契约从 CLI-first 调整为 SDK-first，并明确 SDK event、CLI fallback、permission profile 和 session id 的边界。

## Impact

- 影响 `packages/core/src/agent-provider-runtime.ts`、provider runtime tests、`packages/core/package.json` 与 lockfile。
- 影响 `openspec/specs/agent-provider-runtime/spec.md` 的正式契约。
- 可能补充 `docs/execution-workspace.md`、`docs/observability.md`、`docs/roadmap.md` 中已落地事实。
- 不改变 API/CLI operator entrypoint 的输入输出形态，不改变 Coordinator Agent Surface 和 agent tools。
