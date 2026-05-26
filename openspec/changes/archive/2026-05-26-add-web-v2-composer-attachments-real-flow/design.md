## Context

Web V2 已经具备 Run Matrix、Focus Drawer、Needs-Me Gate Inbox、Workflow Lens 和 `Run until blocked`。当前缺口是统一输入入口与本地附件：旧 Web 的 New Task / Task Cockpit 入口已经被移除，但新的 Composer 仍是 disabled placeholder，Attachment Shelf 也只是 reserved drop zone。

本切片跨 Web、API、Core、DB、Surface 和 Observability，但仍必须遵守既有边界：Web 不直接写 SQLite，不执行 workflow CLI，不读取 `.workflow` private state；附件内容不进入 Core 状态判断，不作为 agent surface 的大段正文；workflow protocol 本期保持不变。

## Goals / Non-Goals

**Goals:**

- 实现桌面 Web V2 `Unified Composer` 的最小可用闭环：创建 task、回复 pending human request、追加 task note / follow-up context。
- 实现本地附件第一版：保存到 Coordinator 管控的 task artifact root，DB 记录 metadata，Web 展示 attachment shelf，Surface/operator summary 只暴露 refs。
- 为附件建立 size/type/path/retention 最小 contract 和 tests。
- 真实 Web smoke 能覆盖创建 task、上传附件或安全占位、run until blocked、观察 workflow stage/substate/internal action 不进 Needs-Me。

**Non-Goals:**

- 不实现移动端。
- 不实现 multipart streaming 或大文件传输系统。
- 不实现 workspace init/cleanup hook 副作用。
- 不修改 workflow protocol，也不把附件自动传入 `.workflow` private state。
- 不让 Composer 自动确认 workflow operator gate 或 merge approval。
- 不把附件内容、图片 OCR、raw file payload 或 provider raw events 放入 Coordinator Agent Surface。

## Decisions

### 1. JSON/base64 上传代替 multipart 依赖

Web 第一版通过 FileReader 将本地文件转成 base64，以 JSON 调用 `POST /tasks/:taskId/attachments`。Core 限制单文件大小和 MIME/extension，并只把解码后的 bytes 写入 artifact root。

Alternative considered: 引入 Fastify multipart streaming。暂不采用，因为本切片目标是本地附件最小闭环，新增依赖和 streaming 生命周期会扩大测试面；后续如果需要大文件再独立设计。

### 2. 新增 `task_attachments` metadata 表

`artifacts` 表只描述通用 artifact path/kind/owner，不保存文件名、MIME、size、retention 等附件专属 metadata。本切片新增 `task_attachments`，同时继续登记 `artifacts` 和 event refs。

Alternative considered: 只复用 `artifacts` 表。拒绝原因是无法测试 size/type/retention contract，也难以让 Web Attachment Shelf 低成本展示。

### 3. 附件路径只落 task artifact root

附件相对路径固定为 `attachments/<attachment-id>/<safe-name>`，绝对路径通过当前 task surface 的 `artifact_root` 解析，并做 realpath containment 校验。文件名做 ASCII-safe normalization，避免路径穿越和 shell/URL 语义歧义。

Alternative considered: 直接写入 project repo 或 workspace visible path。拒绝原因是会污染 repo，并绕过 Coordinator artifact root；workspace/agent 可见性应由后续受控 materialize/ref 机制决定。

### 4. Composer 只做低风险上下文入口

Composer 未选 task 时调用 `POST /tasks`；选中 pending human request 时调用现有 answer API；选中无 gate 时调用新的 task note API 写 artifact/event。operator-facing workflow gate 仍使用 Focus Drawer gate panel 的显式按钮，不由 Composer 自动提交。

Alternative considered: Composer 自动根据文本猜测并确认 workflow gate。拒绝原因是会扩大 Web action surface，破坏 Core policy gate 和人工确认边界。

## Risks / Trade-offs

- [Risk] base64 JSON 会放大 payload，且不适合大文件。→ Mitigation: 设置小尺寸上限，并在 spec 中声明后续大文件需独立 streaming change。
- [Risk] task note / attachment refs 可能被误当成 agent guidance。→ Mitigation: Surface 只展示短 metadata/ref，不读取文件内容；agent 是否读取仍由 surface/artifact path 明确说明。
- [Risk] Composer 语义过多导致 UI 混乱。→ Mitigation: 只用当前 selection 和 gate projection 派生 mode；不在 UI 里展示复杂解释文案。
- [Risk] 旧 smoke DB 缺少新 migration。→ Mitigation: migration 走既有 `runMigrations`，真实验证前执行 migrate 或使用最新 test DB。

## Migration Plan

1. 增加 DB migration 与 repository 函数，支持 task attachment metadata 和 note artifact/event。
2. Core 增加 operator-only runtime helper，负责 path containment、size/type 校验、artifact 写入和 event 记录。
3. API 增加 task attachment / note endpoints。
4. Web V2 替换 Composer placeholder 和 Attachment Shelf，展示 task attachments 并提交 Composer intent。
5. 补 DB/Core/API/Web model tests，运行 OpenSpec validate、build/typecheck 与浏览器验证。
