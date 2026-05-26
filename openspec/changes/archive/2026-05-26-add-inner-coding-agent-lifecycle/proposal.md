## Why

当前 Web smoke 已能启动 workflow run 并停在 `freeze-requirements`，但 `workflow gate evidence` 仍然缺少真正来自 inner coding agent 的 SDK 可见输出，导致 Web 只能正确地拒绝盲确认，不能继续形成“agent 先解释、人再确认”的闭环。现在需要补齐 Coordinator 侧 inner coding agent 生命周期，让 daemon 管理多个 workflow 时默认观察和等待 inner agent，而不是把 workflow `allowedActions` 直接推给开发者。

## What Changes

- 新增 SDK-backed inner coding agent runtime：Core 在 ready workspace 的 `repo/` 内启动 `role=inner` agent session，复用既有 Codex / Claude SDK provider adapter、transcript、final response 和 normalized activity 分层。
- 为 inner session 生成专用 prompt：要求 coding agent 在 workspace repo 中按 workflow 约束推进任务，遇到真正 operator gate 时停止，并用 final response 给出可见确认依据；不得自动确认 human gate 或 merge gate。
- daemon 在 workflow active、workspace ready、缺少可用 inner evidence 且没有 active inner session 时，启动一次 inner coding agent；agent 运行中只观察，不因 `allowedActions/actionInputs` 打断用户。
- inner session 完成后，daemon 通过既有 workflow protocol status 做 read-only inspect/reconcile；operator-facing gate 继续由 Web/API/CLI operator-only action 和 Core evidence 校验确认。
- Web/operator detail 展示 inner session activity/final response refs，继续把 `materialize-change` 等 agent/internal action 仅放入 Workflow Lens / Debug Detail。
- 更新 docs/roadmap，记录本轮 Coordinator 侧 lifecycle 落地；本期不修改 `/Users/hetao/Documents/github/workflow`，也不修改 workflow protocol schema。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `agent-provider-runtime`: 增加 inner coding agent session runtime，明确 inner provider cwd、permission profile、prompt/evidence/artifact 边界。
- `daemon-runtime`: 增加 daemon 对 inner coding agent 生命周期的调度与观察规则，确保不会自动确认 workflow action 或 human gate。
- `workflow-gate-evidence`: 明确 ready evidence 由 inner SDK session final response 形成，并由本轮 inner runtime 产出。
- `observability`: 增加 inner session lifecycle、activity、final response artifact 与 post-agent workflow inspect 的可观测性边界。
- `web-human-review-surface`: 补充 Web V2 对 inner session evidence/activity 的展示边界，不扩大 workflow action surface。

## Impact

- Affected code:
  - `packages/core/src/agent-provider-runtime.ts`
  - `packages/core/src/daemon-runtime.ts`
  - `packages/core/src/operator-surface.ts`
  - `packages/core/src/index.ts`
  - `apps/api/src/runtime-worker.ts`
  - `apps/web/src/main.tsx`
  - Core/API/Web tests as needed
- Systems:
  - 继续使用现有 `@openai/codex-sdk` / `@anthropic-ai/claude-agent-sdk` adapter，不新增 provider 依赖。
  - Web 不直接调用 workflow CLI；Core 仍是唯一 workflow action gate。
  - daemon 不执行 `workflow protocol action`，不自动确认 human gate，不自动 merge。
  - Coordinator 不读取或写入 `.workflow` private state；workflow protocol 保持现状。
