## Why

Iteration 12 已经补齐多类 recovery decision、operation replay、workspace/lock/fencing、PR/MR merge reconciliation 和第二个平台 provider，但 operator 目前只能从通用 timeline 中手动拼接“当前卡在哪里、最近恢复判断是什么、retry 还剩多少、哪些外部事实被 inspect 过”。这会削弱无人值守运行后的排查效率。

本 change 用 operator-only diagnosis summary 把这些已有机器事实翻译成可读诊断面，服务 Web/API/CLI 调试，不扩大 Coordinator Agent surface，也不引入新的状态机。

## What Changes

- 在 Core operator task detail 中新增 `diagnosis` 摘要，聚合：
  - current blocker。
  - recovery decision timeline。
  - retry budget 摘要。
  - operation ledger 摘要。
  - provider/protocol inspect 摘要。
  - 当前 operator attention 风险。
- Web task detail 展示 diagnosis 区域，让 operator 不必从原始 timeline 手动拼接恢复状态。
- API `GET /tasks/:taskId` 返回同一 diagnosis summary；不新增 agent-facing endpoint。
- 保持 Coordinator Surface 不新增 recovery tool，不泄漏 provider raw output、lock token、完整 operation JSON 或复杂内部 recovery matrix。
- 补充单测，覆盖 diagnosis 汇总、payload 收窄、Web/API 输出，以及 surface 未被扩大。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `core-data-model`: task detail operator summary 需要包含 operator-only diagnosis summary，且继续只来自已持久化机器事实。
- `web-human-review-surface`: Web operator surface 需要展示 recovery 诊断摘要、operation ledger 摘要和 provider/protocol inspect 摘要。
- `coordinator-surface`: 明确 operator diagnosis 不得扩大 agent-facing Markdown 或 available tools。

## Impact

- 影响 `packages/core/src/operator-surface.ts`：新增 diagnosis summary 构建逻辑和类型。
- 影响 `apps/api/src/server.ts`：复用现有 task detail 返回结构，无需新增复杂 API。
- 影响 `apps/web/src/main.tsx` / `apps/web/src/styles.css`：展示 operator-only diagnosis。
- 影响 `packages/core`、`apps/api` 测试。
- 不新增外部依赖，不做 SQLite migration，不改变核心状态机或 provider protocol。
