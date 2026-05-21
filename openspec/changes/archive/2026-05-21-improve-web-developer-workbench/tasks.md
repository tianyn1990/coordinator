## 1. Workbench 数据派生

- [x] 1.1 梳理现有 Web 数据类型，补充 Workbench 所需的展示派生类型：project rail、mission metrics、task card、action inbox item。
- [x] 1.2 从现有 `/projects`、`/tasks`、`/tasks/:taskId` 数据派生 project counts、status counts、needs-me、attention 和任务卡片摘要。
- [x] 1.3 为 workflow/PR/MR/human request 信息缺失场景实现安全 fallback，不伪造 stage/substate/handoff。

## 2. Workbench 视图与导航

- [x] 2.1 将现有 Web 入口重组为 Workbench 默认视图，保留 refresh、daemon tick 和 task selection。
- [x] 2.2 新增 Project Rail、Mission Strip、Workbench Board 和 Action Inbox 组件。
- [x] 2.3 将现有密集 task detail 封装为 Classic Debug 视图，并从 task card/debug action 可达。
- [x] 2.4 为后续 Task Cockpit、Project Admin、New Task 预留导航入口，但不实现后续切片的完整能力。

## 3. 视觉与响应式体验

- [x] 3.1 按 `industrial mission control` 方向重写 Workbench 关键样式：深色石墨底、状态灯、任务卡片、Action Inbox，并保留 Classic Debug 作为本切片调试入口。
- [x] 3.2 保证桌面和窄屏布局可读，文本不溢出，默认页面不铺满 raw timeline/debug payload。
- [x] 3.3 保持现有 human answer、merge approval、task controls、daemon tick 操作仍可从对应视图触发。

## 4. 验证与文档收尾

- [x] 4.1 运行 Web build、typecheck 和相关测试，修复发现的问题。
- [x] 4.2 如可行，启动本地 Web/API 或使用静态/浏览器验证 Workbench 主要状态无明显布局问题。
- [x] 4.3 更新 `docs/roadmap.md` 的 Iteration 13 进度记录。
- [x] 4.4 运行 `openspec validate improve-web-developer-workbench --strict` 和 `openspec validate --all --strict`。
