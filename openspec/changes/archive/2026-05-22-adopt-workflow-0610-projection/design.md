# Design

## 1. Projection 边界

Workflow 0.6.10 新增的 `progress` 和 `stageArtifacts` 属于 machine-facing protocol projection。Coordinator 只在 adapter 中做结构化、窄字段解析，并把结果写入外层 workflow event payload，供 operator UI 展示。

这些字段不得参与：

- task status 迁移。
- workflow run coarse status 判断。
- PR/MR readiness 判断。
- merge approval 判断。
- daemon 自动 action。
- Coordinator Agent Surface tool visibility。

## 2. Adapter 解析策略

`WorkflowStatus` 增加：

- `progress?: { label?: string; summary?: string; ordinal?: number; total?: number }`
- `stageArtifacts: Array<{ kind?: string; path: string; label?: string; requiredForHandoff?: boolean }>`

解析约束：

- `progress` 缺失时保持 `undefined`，不伪造进度。
- `stageArtifacts` 缺失时保持空数组。
- `stageArtifacts.path` 必须是 protocol stdout 中的相对展示路径；adapter 不读取文件、不检查存在性。
- `stageArtifacts` 使用与 handoff artifacts 类似的轻量结构，但不代表 handoff 已达成。
- `actionInputs` 继续只转成 `actionInputHints`，避免 raw workflow action schema 进入外层事件。

## 3. Event payload

`protocolStatusEventPayload` 增加：

- `progress`
- `stageArtifacts`

`debug` 仍保留 `stage/substate/gate/allowedActions/deniedActions/currentChange/eventLog`。

这样 Web 的 `extractWorkflowProjection` 可以继续从 event payload 读取，无需调用 workflow protocol 或读取 `.workflow` private state。

## 4. 测试重点

- `status` 中的 `progress/stageArtifacts` 被持久化到 `workflow.status_inspected` payload。
- 成功 `action` 返回的 post-action projection 同样保留 `progress/stageArtifacts`。
- 即使 `stage/substate/progress` 看似完成，外层 workflow run 仍只按 handoff 判断。
- event payload 不包含 raw `actionInputs`。
- 不新增 Agent Surface tools。
