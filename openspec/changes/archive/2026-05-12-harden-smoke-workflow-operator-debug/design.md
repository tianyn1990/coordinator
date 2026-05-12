## Context

第一轮真实 smoke 使用隔离 DB、隔离 clone 和 coordinator-created workspace 验证了当前链路。结果表明核心协议和 workspace 隔离基本可用，但 operator 侧的本地运行入口、SQLite 短暂并发写冲突，以及 workflow action 参数可见性需要 hardening。

本 change 只处理 coordinator 侧可独立修复的部分。workflow 侧 protocol schema 正式化通过新增 handoff 文档交接，不在本仓库直接修改 `/Users/hetao/Documents/github/workflow`。

## Decisions

### 1. 修正现有 root scripts，而不是保留临时绕过命令

`pnpm --filter @coordinator/cli start -- ...` 在当前 pnpm/script 组合下会把 `--` 传给 `packages/cli/src/index.ts`。修复应让用户继续使用正式 root scripts，而不是把 `pnpm --filter @coordinator/cli exec tsx ...` 写成长期主路径。

### 2. SQLite 只做 P0 级 busy timeout，不引入全局锁服务

`workflow status/events` 等 operator debug 查询会写审计 event 或 status snapshot。短时间并发时应允许 SQLite 等待 writer 释放，因此在 `openDatabase` 设置 `PRAGMA busy_timeout = 5000`。

本 change 不引入跨进程锁服务或新调度器。后续 Web/daemon 若需要连续 debug 写操作，应在调用层串行化或限流。

### 3. 保留 operator debug 的审计副作用

不把 `workflow status/events` 改成纯读。当前 observability 设计要求 inspect 动作可审计，operator 需要看到谁在什么时候 inspect 了 workflow 状态或 events。

同时必须明确这些入口是 operator-only 调试面，不是 Coordinator Agent Surface，也不是高频 polling API。

### 4. `actionInputs` 只投影为 sanitized action input hints

coordinator 不读取 `.workflow` private state，只消费 protocol stdout JSON。raw protocol status 中的 `actionInputs` 可以被视为 workflow protocol 输出，但 coordinator 只保留窄字段：

- action id。
- `requiredArgs` string array。
- 可选 `usage` string。

不保存完整 raw workflow status，不把复杂 JSON 塞进 event payload，不让这些 hint 驱动外层状态机或 tool visibility。

### 5. Agent-facing 暴露另行设计

本轮不把 `actionInputs` 暴露进 Coordinator Agent Surface。若后续真实 outer agent 需要自动执行带参 workflow action，应单独更新 `docs/workflow-protocol.md`、`docs/coordinator-surface.md` 和 `docs/agent-tools.md`，明确哪些 action input hint 可以进入 agent-facing surface，以及如何保持窄参数和 artifact-first 约束。

## Risks

- `busy_timeout` 只能缓解短暂写冲突，不能支撑高并发 polling。通过文档说明 operator debug 使用边界。
- workflow 侧如果未把 `actionInputs` 纳入稳定 schema，coordinator 只能 best-effort 投影。通过 handoff 文档交接 workflow 工程补齐协议正式化。
- 若 event payload 直接保存 raw status，会违反 observability 的复杂对象约束。实现中只保存窄摘要。

## Validation

- 静态确认 root scripts 不再传入裸 `--`。
- 轻量命令验证 `pnpm migrate --db <tmp-db>` 和 `pnpm cli projects --db <tmp-db>`。
- OpenSpec strict validate。
- 不特意执行单测；如用户后续要求，再跑 targeted tests。
