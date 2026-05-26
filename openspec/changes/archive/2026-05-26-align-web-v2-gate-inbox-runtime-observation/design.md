## Context

Slice 15.1 已将 Web 默认入口重建为桌面端 Run Matrix + Focus Drawer。当前 Web V2 已具备基础展示模型、workflow lens、operator-facing workflow gate、task-scoped/global `Run until blocked` loop 和 Debug Detail，但 Gate Inbox 与 run banner 仍需要进一步收敛到新流程。

本切片必须继续遵守既有边界：不修改 workflow protocol，不读写 `.workflow` private state，不新增 daemon 自动 workflow action，不让 outer Agent 自动确认 human gate，也不把 raw provider events 或 workflow debug 字段升级成新状态机。

## Goals / Non-Goals

**Goals:**

- 将 Web V2 的 `Needs me`、Run Matrix pin、Focus Drawer gate list 和 Command Bar count 统一到同一个 gate projection。
- 明确区分 operator-facing gate、agent/internal action、debug-only/unknown action。
- 让 `Run until blocked` banner 使用 observation-aware stop reason，分别表达 observing runtime、waiting operator gate、handoff ready、recovery attention、terminal、no candidate、max ticks。
- 让 task-scoped run 只显示当前 task 的停止原因；global run 只显示全局 queue 结果摘要，不覆盖当前 task 的 owner/mode。
- 保持 operator-facing workflow action 继续通过 API/Core runtime 提交。

**Non-Goals:**

- 不实现 Unified Composer 的完整创建、回复或附件行为。
- 不实现新的 Core 状态机或新的 Web summary API。
- 不修改 workflow protocol，也不依赖未来 `operatorActions`、`agentActions`、`blocker.owner` 或 `agent.state` 字段。
- 不新增 daemon 自动 action executor。
- 不改变 PR/MR merge approval gate 或 human approval gate。
- 不做移动端适配。

## Decisions

### 1. 单一 gate projection 驱动 Needs-Me

Web V2 使用一个 `GateItem` 派生函数同时服务 Command Bar count、Run Matrix pin、Focus Drawer gate list 和 E2E tests。进入 gate projection 的条件只包括 pending human request、pending merge approval、operator-facing workflow gate、Core recovery attention/high-risk、PR/MR review required/conflict 和 project/provider blocker。

Alternative considered: 在各组件内分别判断 needs-me。拒绝原因是不同组件容易出现 count、pin、drawer 不一致，且会重新制造旧 Action Inbox 漂移。

### 2. workflow observation 是解释层，不是真相源

Web 可以使用 Core/API 提供的 `workflowObservation`，或用 shared classification 从已持久化 workflow event payload 派生同源 observation。该 observation 只用于展示 owner/mode 和 stop reason，不写回 Core DB，不决定 PR readiness、done 或 merge。

Alternative considered: 前端维护一套完整 workflow action 状态机。拒绝原因是它会复制 workflow/Core 规则，增加 drift 风险。

### 3. Run Until Blocked banner 分 scope 展示

task-scoped run 的 banner 只以目标 task detail 和本轮 tick summary 解释停止原因。global run 只展示全局 tick/action 摘要和 no-candidate/max-ticks/failure 等 queue 层结果，不把其他 task 的 failed/attention 写成当前 Focus Drawer 的 blocker。

Alternative considered: 全局 run 停在任何 task attention 时直接提示当前 drawer。拒绝原因是多任务管理场景下会造成历史任务污染当前任务。

### 4. internal/debug action 只进入 Lens 和 Debug Detail

`materialize-change`、`run-alignment-checks`、inspect/resume、unknown/debug-only action 可以在 Workflow Lens 中展示 action hint、required args 和 usage；只有 shared classification / observation 明确为 operator-facing 时才展示可提交 gate。

Alternative considered: 为 internal action 提供 disabled card。拒绝原因是 disabled card 仍会把 developer 视线拉回 workflow 遥控器心智；更合适的位置是 Lens/Debug Detail。

## Risks / Trade-offs

- [Risk] 现有 `/tasks/:id` detail N+1 仍会限制大列表性能。→ Mitigation: 本切片只收敛 projection，不新增 API；后续如有性能压力再设计只读 summary endpoint。
- [Risk] Web 侧 fallback observation 可能与 Core 最新实现漂移。→ Mitigation: 优先使用 `detail.workflowObservation`；fallback 仅用于缺失字段和测试，且复用 `@coordinator/shared` classification。
- [Risk] legacy spec 中仍有旧 Task Cockpit/Action Inbox 文字。→ Mitigation: 本切片继续新增/修改 Web V2 明确要求；后续可用独立 spec cleanup change 清理历史要求。
- [Risk] banner 变得过于文本化。→ Mitigation: 只保留短 owner/mode、stop kind 和最近 tick 数量，详细原因仍放 Focus Drawer / Debug Detail。

## Migration Plan

1. 扩展 Web V2 display model，增加 stop reason / gate projection helper。
2. 调整 Run Matrix、Command Bar、Focus Drawer 和 banner 消费同一 projection。
3. 补充 tests 覆盖 internal action、operator gate、PR review/conflict、scope 隔离和 banner stop reason。
4. 运行 Web build、typecheck、OpenSpec validate 和浏览器桌面验证。
5. subagent review 后修复 must-fix，归档 change 并提交。
