## 1. Web V2 展示模型

- [x] 1.1 梳理现有 Web 数据类型与 API 调用，定义 Run Matrix row、Focus Drawer、outer lifecycle rail、workflow stage rail、status pin 和 debug detail 的前端展示模型。
- [x] 1.2 从现有 task/project/detail 数据派生 Run Matrix row；缺失 attempt/workspace/workflow/PR/human request 时使用安全 fallback，不伪造 stage/substate/handoff。
- [x] 1.3 复用现有 workflow runtime observation / action classification，确保 agent/internal action 不会生成 needs-me pin 或 gate item。

## 2. Web V2 Shell 与组件

- [x] 2.1 从头重写 Web 默认入口为单页 `WorkbenchShell`：Command Bar、Run Matrix、Focus Drawer、Unified Composer 占位和 Debug Detail。
- [x] 2.2 实现 Run Matrix task row：`data-task-id`、project/title/status、outer lifecycle rail、workflow stage rail、stage/substate chip、owner/mode、heartbeat、needs-me pin 和 focus/debug action。
- [x] 2.3 实现 Focus Drawer：task summary、workflow summary、agent activity summary、operator gate 摘要、recent evidence、attachments shelf 占位和 Workflow Lens / Debug Detail 入口。
- [x] 2.4 删除旧 Workbench board、Task Cockpit、Classic Debug、New Task、Project Admin 页面结构；必要 debug 能力只通过 Focus Drawer 内的 Debug Detail 可达。

## 3. 视觉与动效

- [x] 3.1 将主界面样式调整为 `Operational Paper + Instrument Status`：浅色、高密度、细线轨道、克制状态色。
- [x] 3.2 为 running、needs-me、failed、done、internal/debug 状态实现稳定尺寸的视觉 marker；动效只表达真实状态，并支持 `prefers-reduced-motion`。
- [x] 3.3 桌面视口下验证文本不溢出、轨道不抖动、Focus Drawer 与 Run Matrix 不重叠；本切片不做移动端验收。

## 4. 验证、review 与收尾

- [x] 4.1 补充或调整 Web 相关测试，覆盖 Run Matrix row、Focus Drawer、internal action 不生成 needs-me、debug detail 默认折叠。
- [x] 4.2 运行 `openspec validate rebuild-web-workbench-v2-shell --strict`、`pnpm --filter @coordinator/web build`、`pnpm typecheck` 和相关测试。
- [x] 4.3 使用浏览器或等价截图验证桌面视口的 Web V2 shell，无明显布局重叠或空白填充。
- [x] 4.4 交给独立 subagent review，明确检查 docs 总体设计、过度设计、Core/Daemon/Workflow protocol/AgentProvider/Web 分层污染、daemon/outer Agent 自动 workflow action、raw provider events 或 workflow debug 字段是否变成新状态机。
- [x] 4.5 修复 review 必须修复项后归档 OpenSpec change，更新 `docs/roadmap.md` 进度记录并提交。
