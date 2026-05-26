## Context

当前 Web 已具备真实 operator surface：可以创建 task、触发 daemon tick、查看 task detail、展示 workflow lens、处理 human request 与 PR/MR gate。但页面结构仍来自旧 Workbench/Task Cockpit/Classic Debug 分层：多任务入口偏 board/card，单任务详情偏 debug console，默认视图容易把 raw detail、timeline、surface 和 workflow action hint 推到开发者面前。

Web V2 的设计基线已经固化在 `docs/web-developer-workbench.md`：默认主视图应是桌面端 Run Matrix，单任务详情应进入 Focus Drawer，Debug Detail 默认折叠。本切片不在旧页面上做迁移式改造，而是重写新的单页前端入口，并删除旧 Workbench board、Task Cockpit、Classic Debug、New Task 和 Project Admin 页面结构；不改变 Core 状态机、workflow protocol、daemon 行为或 API 副作用边界。

## Goals / Non-Goals

**Goals:**

- 建立全新的桌面端 Web V2 单页 shell：Command Bar、Run Matrix、Focus Drawer、Unified Composer 占位、Debug Detail Drawer。
- 将 task 摘要从卡片堆叠改为行式 Run Matrix，支持一屏扫描多个 workflow。
- 在 Run Matrix 行内展示外层 lifecycle rail、workflow stage rail、stage/substate chip、owner/mode、heartbeat、needs-me pin 和 focus action。
- 将单任务摘要集中到 Focus Drawer，并默认折叠 raw/debug 信息。
- 删除旧页面结构，避免旧代码继续影响 Web V2 的交互和视觉。
- 使用 `Operational Paper + Instrument Status` 视觉方向，表达 running、needs-me、failed、done 和 internal/debug 状态。
- 保持所有副作用仍通过现有 API/Core runtime。

**Non-Goals:**

- 不实现 Unified Composer 的完整创建、回复或附件上传行为。
- 不实现本地附件落地、workspace materialize 或 attachment metadata。
- 不修改 workflow protocol，也不要求新增 `operatorActions`、`agentActions` 或 `agent.state`。
- 不新增 daemon 自动动作，不让 daemon/outer Agent 自动执行 workflow action。
- 不改变 Core 状态机、task 状态迁移、PR/MR merge gate 或 human approval gate。
- 不做移动端或手机屏幕适配。
- 不引入通用 DAG engine 或重型 UI framework。

## Decisions

### 1. 用 Run Matrix 作为默认首页，而不是继续扩展旧 board/card

Run Matrix 更适合多 workflow 管理：每个 task 一行，轨道、chip、pin 和 heartbeat 可以横向对齐，开发者能快速扫描“谁在跑、谁需要我、谁失败”。旧 card board 更适合少量任务和状态分组，但会在多任务场景下放大空间消耗，并诱导继续加入说明性填充内容。

Alternative considered: 继续在旧 Workbench Board 上优化 card。拒绝原因是旧 board 很难同时稳定展示 outer lifecycle 与 workflow stage/substate，也不利于后续在同一屏管理更多任务。

### 2. Focus Drawer 替代旧单任务页面

选中 task 后打开右侧 Focus Drawer，可以保留多任务上下文，减少在列表和详情之间切换的成本。Drawer 展示 task summary、workflow summary、agent activity、operator gate、evidence、attachments shelf 和 Workflow Lens 入口；raw timeline、surface、operation ledger 和 provider/protocol detail 仍可从 Debug Detail Drawer 查看。

Alternative considered: 保留 Task Cockpit 作为单任务主页面。拒绝原因是它会继续把用户带回单任务 debug 心智，和 Web V2 的多 workflow 管理目标冲突。

### 3. 删除旧页面而不是保留双轨 UI

本切片删除旧 Workbench board、Task Cockpit、Classic Debug、New Task 和 Project Admin 页面结构，只在 Web V2 单页中保留必要的 operator action、debug detail 和 composer 占位。这样可以避免样式、状态、导航和测试继续被旧 UI 影响。

Alternative considered: 保留旧页面作为 fallback。拒绝原因是双轨 UI 会让后续实现继续在旧心智里打补丁，也会增加真实 Web smoke 的判断复杂度。

### 4. 前端只做展示派生，仍复用现有 API 数据

本切片优先复用现有 `/projects`、`/tasks`、`/tasks/:taskId` 和 task summary/detail 数据，在前端派生 Run Matrix row 和 Focus Drawer view model。若后续出现 N+1 或 payload 噪音，再单独设计只读 summary API。

Alternative considered: 先新增专用 Run Matrix summary API。暂不采用，因为当前切片目标是 UI shell 和信息结构，新增 API 会扩大实现与验证范围，并可能提前固化尚未稳定的展示模型。

### 5. Needs-me pin 依赖已有 Core classification / observation，不在前端重建业务规则

Web 可以读取 task detail 中已有 human request、merge approval、diagnosis、workflow runtime observation 和 action classification 结果来展示 pin；不得根据 `allowedActions.length > 0` 自行生成 needs-me。

Alternative considered: 在前端维护完整 allowed action 分类表。拒绝原因是会把 workflow/Core 边界复制到 Web，增加 drift 风险。

### 6. 视觉采用浅色 Operational Paper，动效只表达状态

默认页面使用浅色、高密度、细线轨道和低饱和状态色，适合长期使用。Instrument Status 只用于真实状态：running flow line、agent heartbeat、amber needs-me pin、red breakpoint、green done marker。遵守 `prefers-reduced-motion`，避免无意义动画。

Alternative considered: 继续旧深色 industrial mission control。拒绝原因是旧风格更像监控大屏或 debug console，和日常开发工作台的低噪音需求不匹配。

## Risks / Trade-offs

- [Risk] 复用现有 task detail API 可能导致首屏加载多个 task detail 的 N+1。→ Mitigation: 本切片保持当前规模可用，必要时只加载 selected task detail；Run Matrix row 使用 task list 和已缓存 detail 的安全 fallback，后续独立补只读 summary API。
- [Risk] 删除旧页面后某些低频 operator 入口暂时不可达。→ Mitigation: Focus Drawer 保留 human request、merge approval、task control、workflow operator gate、run current task 和 Debug Detail；完整 task creation / project admin / attachments 后续由 Unified Composer 和独立切片补齐。
- [Risk] 轨道/chip 信息密度过高导致可读性下降。→ Mitigation: 固定轨道尺寸、短标签、tooltip/aria-label、桌面截图验证，不做移动端压缩。
- [Risk] 前端误把 debug action 当成 needs-me。→ Mitigation: needs-me pin 只基于现有 Core/operator facts 与 observation；测试覆盖 internal action 不生成 needs-me。
- [Risk] 动效造成干扰或布局抖动。→ Mitigation: 用 CSS transform/opacity 表达状态，轨道尺寸稳定，支持 `prefers-reduced-motion`。

## Migration Plan

1. 用新的 Web V2 单页入口替换现有 Web root component。
2. 将现有 task/project/detail 数据接入 Run Matrix 与 Focus Drawer。
3. 删除旧页面级组件、旧导航 view mode 和旧深色 board/cockpit 样式。
4. 将 raw/detail 能力压缩到 Focus Drawer 内的 Debug Detail，不保留旧 Classic Debug 页面。
5. 通过 build/typecheck、针对性测试和浏览器截图验证桌面布局。
6. 如需回滚，可以恢复旧 Workbench 根组件；API/Core/DB 未变更，回滚不涉及数据迁移。
