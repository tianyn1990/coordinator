## ADDED Requirements

### Requirement: Coordinator Surface 必须只暴露 attachment refs

系统 SHALL 在 task brief / operator summary 中暴露 task attachments 的短 metadata 和 artifact refs；系统 SHALL NOT 将附件正文、base64、图片内容、raw binary payload 或完整文件预览写入 Coordinator Agent Surface。

#### Scenario: surface 展示 attachment ref

- **WHEN** task 存在 attachments
- **THEN** Coordinator Surface Markdown 可以列出 attachment safe filename、MIME/size 摘要和 artifact path
- **AND** Surface JSON 只包含 artifact refs 或短 metadata

#### Scenario: 大文件内容不进入 prompt

- **WHEN** attachment 是图片、PDF、日志或其他二进制/长文本文件
- **THEN** agent-facing Markdown 不包含文件正文或 base64
- **AND** agent 只能通过明确 artifact ref 判断是否需要读取

### Requirement: Task note 必须作为 artifact/ref 暴露

系统 SHALL 将 Web Composer 追加的 task note 写入 artifact，并在 Surface 中只以 recent context ref 或 event summary 呈现；note 不得成为 hidden memory 或绕过 current task state 的隐式状态。

#### Scenario: task note 进入 surface ref

- **WHEN** operator 通过 Composer 追加 task note
- **THEN** Core 写入 task note artifact 和 event
- **AND** Surface 可展示最近 note artifact ref
- **AND** Surface 不把所有历史 note 正文无限拼入 prompt
