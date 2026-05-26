## ADDED Requirements

### Requirement: Attachment 与 Composer 行为必须可审计

系统 SHALL 为 Web Composer 创建 task、回复 human request、追加 task note 和上传 attachment 记录可审计 event；event payload 必须是窄摘要并使用 artifact refs 引用正文或文件。

#### Scenario: attachment upload event

- **WHEN** attachment 上传成功
- **THEN** event timeline 包含 `task.attachment_uploaded`
- **AND** payload 包含 attachment id、safe filename、MIME、size、actor 和 retention kind
- **AND** payload 不包含 raw base64 或文件正文

#### Scenario: task note event

- **WHEN** Composer 追加 task note
- **THEN** event timeline 包含 `task.note_added`
- **AND** event artifact refs 指向 note artifact path
- **AND** event payload 只包含 actor、note artifact path 和短摘要

#### Scenario: failed validation 不写审计成功事件

- **WHEN** attachment 因 path、size 或 type 校验失败
- **THEN** Core 不写 `task.attachment_uploaded`
- **AND** 不创建 artifact metadata 指向不存在文件
