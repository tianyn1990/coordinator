## Context

本轮是 `Iteration 12: P1 / P2 Hardening` 的第一个切片。当前 P0 闭环已有 task 创建、human answer、PR/MR approval、merge 和 daemon tick 调试入口，但 Web 目标中列出的 `pause/resume/cancel/retry` 还没有落地。

这些动作属于 operator intervention，不属于 Coordinator Agent tool。它们必须走 Core policy gate，而不是由 Web/CLI 直接更新 SQLite。这样可以保持既有边界：

- Coordinator Core 是唯一状态机和策略校验层。
- Web/CLI 是 operator surface。
- Daemon 是可靠运行时，不做业务语义判断。
- Coordinator Agent 只能看到当前 surface 暴露的 agent tools，不能看到 operator-only tools。

## Goals / Non-Goals

**Goals:**

- 提供 Core task control service，统一处理 pause、resume、cancel、retry。
- 为每个 control 做 CAS 校验、状态合法性校验和 append-only event 记录。
- API/CLI/Web 都复用同一个 Core service。
- retry 与既有 daemon retry 语义对齐：安排恢复，等待 daemon 根据 due time 和最新 surface 推进。
- Web task detail 展示 task controls，并在操作后刷新 detail。
- 补充 tests，覆盖状态校验、event、surface 不暴露 operator-only tools、daemon 不推进 paused/canceled task。

**Non-Goals:**

- 不实现复杂 dead-letter/circuit breaker UI。
- 不新增通用 task state machine DSL。
- 不清理 workspace、branch、PR/MR 或外部 provider session。
- 不让 Coordinator Agent 调用 pause/resume/cancel/retry。
- 不改变 merge approval、workflow handoff 或 provider adapter 边界。

## Decisions

### Decision 1: task controls 放在 `operator-surface` Core service 中

选择：在 `packages/core/src/operator-surface.ts` 中新增 `controlTaskRuntime` 或等价函数，API/CLI/Web 只调用该入口。

原因：这些动作是 operator surface 的人工介入能力，和 `recordHumanAnswerRuntime` 同属 operator-only 行为。放在 Core service 能确保 CAS、event 和状态校验一致。

备选：在 API/CLI 中直接调用 `updateTaskStatus`。拒绝，因为这会绕过 Core gate，让多个入口复制状态规则。

### Decision 2: task 状态使用现有 status 字符串，不新增 migration

选择：第一版直接使用现有 `tasks.status` 字符串字段，新增语义状态 `paused`，并复用已有 `resuming`、`canceled`。

原因：schema 已经使用 string status，没有 enum constraint。新增 migration 不能提供额外约束价值，反而会把本轮 hardening 扩大为数据模型重构。

备选：新增 `paused_at`、`pause_reason` 等字段。拒绝，第一版原因和操作人可通过 append-only event 审计，后续需要更强查询能力时再独立加字段。

### Decision 3: resume 只从 paused 恢复到 resuming

选择：operator resume 只允许 paused task，恢复到 `resuming`，由 daemon 后续生成 surface 并唤醒 Coordinator Agent。

原因：resume 的目标是恢复无人值守推进，而不是让 operator 指定任意状态。恢复到 `resuming` 能复用当前 daemon `retry_due` / surface / agent session 机制。

备选：resume 直接恢复到 pause 前状态。拒绝，因为当前没有持久化 pause 前状态字段，直接恢复可能绕过最新事实和 retry gate。

### Decision 4: retry 安排有 dueAt 的恢复，而不是立刻执行副作用

选择：operator retry 将非 terminal、非 waiting human/review/merge approval 的 task 设置为 `resuming`，写 `operator.task_retry_requested` event，payload 带 `dueAt`。

原因：retry 应由 daemon 在后续 tick 中根据预算、due time、surface 和 Core gate 推进，operator 不应绕过 Coordinator Agent 或 workflow protocol。

备选：retry API 直接调用 `runDaemonTick` 或直接启动 agent。拒绝，因为这会把 operator action 和 daemon scheduling 合并，降低幂等和排查清晰度。

### Decision 5: cancel 是 terminal task control，但不清理外部副作用

选择：cancel 只把 task 置为 `canceled`，记录 operator、reason 和 event。后续 cleanup、workspace archive、PR close 需要独立能力。

原因：删除 workspace 或关闭 PR/MR 都是额外副作用，必须有独立 operation/idempotency/reconciliation 契约。本轮只做 task lifecycle hardening。

备选：cancel 同时清理 workspace 和 PR/MR。拒绝，容易引入破坏性副作用，且不符合本轮 operator control 的收敛范围。

## Risks / Trade-offs

- [Risk] `paused` 是新状态但没有额外字段记录 pause 前状态。  
  Mitigation: pause/resume 都记录 event；resume 进入 `resuming`，由 daemon 基于最新 surface 决策，不依赖旧状态。

- [Risk] retry dueAt 只存在 event payload 中，查询效率有限。  
  Mitigation: 当前 daemon 已按 event 查询 `daemon.retry_scheduled`；本轮复用同类事件并在实现中保持查询收口。若未来需要大规模队列，再引入专门 schedule 表。

- [Risk] operator cancel 后仍可能存在 workspace/PR/MR。  
  Mitigation: 明确文档和 UI copy：cancel 是停止 coordinator 自动推进，不是外部资源清理。

- [Risk] Web 增加按钮后可能误导用户以为是 agent tools。  
  Mitigation: buttons 只调用 operator API；测试确保 Coordinator Surface 不暴露这些工具。

## Migration Plan

- 无数据库 migration。
- 新增 Core runtime 和入口后，通过 tests 验证旧 task 数据仍可用。
- 如回滚本 change，已产生的 `paused` task 可由 operator 手动改为 `resuming` 或 `canceled`；这是开发期行为，不影响 schema。

## Open Questions

- 暂无需要用户确认的设计变更。本轮在既有设计边界内实现。
