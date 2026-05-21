## Context

当前 Web 已支持 project/task 加载、manual task 创建、task detail、human request answer、merge approval、task controls、daemon tick、diagnosis 和 timeline 展示。但主界面仍是单任务 debug console：用户必须先选中一个 task，才看到大量底层信息。这与 `docs/web-developer-workbench.md` 中确认的产品心智不一致：Web 应作为开发者同时管理多个工程、多个任务的主入口。

本切片是 Iteration 13 的第一步，只重构 Web 信息架构与多任务入口。Task Cockpit、Workflow Lens、Project Admin、Run Until Blocked 的完整实现留给后续切片，但本轮需要为这些视图预留导航和组件边界。

## Goals / Non-Goals

**Goals:**

- 新增 Developer Workbench 默认视图，展示多 project、多 task 的局面。
- 提供 Project Rail、Mission Strip、Workbench Board、Action Inbox，并保留 Classic Debug 作为本切片的 raw detail / debug 入口。
- 将现有密集 task detail 保留为 Classic Debug，不删除当前 operator 排查能力。
- 通过 Web 侧派生模型从现有 API 数据形成 task card、inbox item 和 board sections。
- 保持所有副作用仍经 API/Core runtime，不扩大 Coordinator Agent Surface。

**Non-Goals:**

- 不实现 Task Cockpit 的完整流程图、Workflow Lens 和完整 System Debug Drawer。
- 不实现 Project Admin 的完整工程注册表单。
- 不实现 Run Until Blocked。
- 不新增 workflow action executor。
- 不修改 Core 状态机、daemon 自动推进规则或 workflow protocol 边界。
- 不实现文件/图片上传。

## Decisions

### Decision 1: Workbench 使用前端派生模型起步

第一版 Workbench 使用现有 `GET /projects`、`GET /tasks`、`GET /tasks/:taskId` 数据，在前端派生：

- project rail counts。
- mission strip metrics。
- board sections。
- action inbox items。
- task card progress。

原因：

- 当前任务数量和本地使用场景下，前端聚合可以快速落地体验。
- 不需要新增只读 API，也不会引入新的 Core truth source。
- 如果后续出现 N+1 或 payload 过大，再在独立 change 中补 operator-only summary API。

替代方案是直接新增 `/workbench` API。该方案长期更高效，但本切片会把 API/Core 和 Web 重构耦合过重。

### Decision 2: 保留 Classic Debug，而不是直接改造旧页面

现有 task detail 对排查有价值，但不适合普通用户默认阅读。本轮把它封装为 Classic Debug / Raw Detail，并从 Workbench task card 或 debug action 进入。

这样可以：

- 降低主页面信息噪音。
- 保留已有 surface/timeline/operation ledger 排查能力。
- 避免一次性重写所有 detail 行为导致回归。

### Decision 3: Action Inbox 聚合“需要我”的事项

Action Inbox 不新增状态，只从 task detail、human requests、merge approval、diagnosis 和 task status 派生。

优先级：

1. merge approval。
2. pending human request。
3. operator attention。
4. PR/MR waiting/review state。
5. failed/unknown high-risk state。

Action card 的按钮必须复用现有 Web handler 或进入对应 detail/debug。不会在 inbox 中直接绕过 Core。

### Decision 4: 视觉先建立系统语言，复杂图形留给下一切片

本轮采用 `industrial mission control` 的基本视觉语言：

- 深色石墨底。
- running 使用冷青。
- waiting/needs human 使用琥珀。
- failed/blocked 使用红色。
- done 使用绿色。
- 用任务卡片、状态灯、轨道和紧凑信息条建立工作台感。

本切片可引入 `lucide-react` 作为图标库；`@xyflow/react` 留给 Task Cockpit 流程图切片，避免范围过大。

## Risks / Trade-offs

- [Risk] 前端聚合多个 task detail 可能导致加载变慢。  
  Mitigation: 第一版限制 detail hydration 范围，优先加载任务列表和选中/需要关注任务；必要时只对最新任务或 inbox candidates 拉 detail。后续可补 operator-only summary API。

- [Risk] Workbench 派生逻辑可能不小心变成业务状态机。  
  Mitigation: 只派生展示分类和优先级，不写 DB，不决定 merge readiness，不根据 workflow stage/substate 推导外层状态。

- [Risk] 保留 Classic Debug 与新增 Workbench 会让代码暂时同时存在两套视图。  
  Mitigation: 把视图拆成小组件，旧 detail 只作为 ClassicDebugView 复用，后续 13.2 再继续拆 Task Cockpit。

- [Risk] mission control 风格过度装饰影响可读性。  
  Mitigation: 视觉效果服务状态识别，避免装饰性大面积渐变和无意义动画；验证桌面和窄屏不重叠、不溢出。
