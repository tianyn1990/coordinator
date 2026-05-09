# Proposal: reconcile workflow action operations

## Why

本地实测发现 `workflow:action` operation 在进入 `unknown` 后缺少正式 recovery 闭环。

具体表现是：`invokeWorkflowAction` 执行 `run-alignment-checks` 时如果 workflow protocol action 已进入 side effect window 但最终失败，operation 会被标记为 `unknown`。修复外部 fixture 后，使用同一个 `workflowRun state_version + action` 再次调用会命中同一个 idempotency key，并返回：

```text
workflow action operation requires reconcile before retry: unknown
```

当前 daemon 已覆盖 `daemon:*` operation、PR/MR operation 和 active workflow run 本体 reconciliation，但没有覆盖普通 `workflow:action` operation。结果是同一 action 的 unknown operation 会永久阻塞，除非通过额外 inspect 推进 workflow run state_version 来绕开。

这违反了既有 operation replay 设计：`running`、`failed`、`unknown` operation 必须先通过对应 resource 的 read-only inspect 对账，再由 Core recovery decision 决定封口、重试、unknown 或 operator attention。

## What Changes

- 将 `workflow:action` operation 纳入 daemon/Core recovery matrix。
- daemon 对 `workflow:action` 只执行 workflow protocol `status --run <run-id>` read-only inspect。
- inspect 与 DB workflow run 可对账时，将旧 action operation 标记为 `reconciled`，写入 recovery decision event，并允许后续基于最新 workflow run state_version 继续推进。
- inspect 不可用、runId/profile mismatch 或无法定位 workflow run 时，保持 operation `unknown`，写入明确 recovery/operator attention event，不推进 workflow run completed 或 handoff。
- 保持 `Coordinator Core` 为 recovery decision owner；daemon 只收集 observation 并执行 Core 允许的动作。

## Non-Goals

- 不直接重放旧 `workflow:action` 副作用。
- 不读取或修改 `.workflow` private state。
- 不根据 workflow stage/substate/gate 推导外层 completed、handoff 或 PR readiness。
- 不新增 Coordinator Agent recovery tool。
- 不改变 workflow protocol schema。

## Validation

- `pnpm typecheck`
- `pnpm test`
- `openspec validate --all --strict`
