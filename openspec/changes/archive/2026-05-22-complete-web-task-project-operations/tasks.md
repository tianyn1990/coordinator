## 1. New Task 与任务创建流程

- [x] 1.1 扩展 Web view state，新增 New Task 视图，并把 Workbench 的 New Task 入口从侧栏小表单调整为主要任务下达页面。
- [x] 1.2 实现 New Task 大文本编辑体验：project、title、description、background、acceptance criteria、constraints、autonomy、workflow hint/default 说明和附件占位。
- [x] 1.3 实现 `Create task` 与 `Create and run until blocked`，创建成功后刷新 Workbench，并可直接进入 Task Cockpit。

## 2. Project Admin

- [x] 2.1 新增 Project Admin 视图和导航入口，展示已有 project registry 的关键配置摘要与缺失状态。
- [x] 2.2 实现 Web project register 表单，调用 `/projects/register`，展示成功/失败结果并刷新 registry。
- [x] 2.3 增加 workspace policy / init hook / cleanup hook / retention policy 的 disabled 占位，明确当前不执行任意脚本副作用。

## 3. Run Until Blocked

- [x] 3.1 实现全局 run-until-blocked operator loop：循环 daemon tick + refresh，展示 tick action summary、最大轮数和停止原因。
- [x] 3.2 实现单任务 run-until-blocked：在 Task Cockpit/New Task created task 上聚焦当前 task，命中 terminal、human request、merge approval、workflow running no handoff、operator attention、PR/MR review、failed/unknown 或 max ticks 时停止。
- [x] 3.3 确保 workflow running without handoff 的停止文案明确说明 inspect-only，不执行 workflow action。

## 4. PR/MR Operator Actions

- [x] 4.1 在 Evidence / Actions panel 中补齐 create/update PR/MR、inspect review、request merge approval 的表单或按钮，并复用既有 API。
- [x] 4.2 在 Classic Debug 中同步暴露相同 PR/MR operator actions，保持 approve/reject/merge 仍由 Core gate 控制。
- [x] 4.3 为 PR/MR 表单提供 key artifact refs 参考，不自动猜测 body artifact 或 approval artifact。

## 5. 验证、Review 与收尾

- [x] 5.1 补充或更新 API/Web 相关测试，覆盖 project register、manual task create 和 daemon tick/run-until-blocked 边界。
- [x] 5.2 运行 Web/API build、typecheck、相关 tests、`openspec validate complete-web-task-project-operations --strict` 和 `openspec validate --all --strict`。
- [x] 5.3 使用 PC 端浏览器验证 New Task、Project Admin、Run Until Blocked 和 Task Cockpit PR/MR actions 的主要布局与交互。
- [x] 5.4 交给独立 `gpt-5.5 high` subagent review，明确检查 docs 边界、过度设计、协议偏离、分层污染和 agent surface 暴露风险。
- [x] 5.5 修复 must-fix 后归档 OpenSpec change，更新 `docs/roadmap.md`，提交本轮改动。
