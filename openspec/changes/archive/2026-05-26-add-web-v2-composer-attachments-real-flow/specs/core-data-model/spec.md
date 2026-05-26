## ADDED Requirements

### Requirement: Core data model 必须记录 task attachment metadata

系统 SHALL 为 task attachment 记录持久化 metadata，包括 attachment id、project id、task id、attempt id、artifact path、original filename、safe filename、MIME type、size bytes、actor、retention kind 和 created at；metadata 不得包含 raw file payload。

#### Scenario: attachment metadata 可查询

- **WHEN** operator 上传 task attachment
- **THEN** DB 持久化 attachment metadata
- **AND** task detail API 可返回该 metadata
- **AND** raw file bytes 只存在 artifact 文件中

#### Scenario: artifact 与 event 可追溯

- **WHEN** attachment 写入成功
- **THEN** Core 同步登记 `artifacts` record
- **AND** 追加 `task.attachment_uploaded` event
- **AND** event artifact refs 包含 attachment artifact path

### Requirement: Attachment path 必须被 containment 校验

系统 SHALL 将 attachment 写入当前 task surface 的 artifact root 下，并对 root、parent directory 和目标 path 做 containment 校验；系统 MUST 拒绝绝对路径、`..` segment、空文件名、危险扩展或超过大小上限的 payload。

#### Scenario: path traversal 被拒绝

- **WHEN** 上传文件名包含 `../`、绝对路径、空 segment 或只剩空 safe name
- **THEN** Core 拒绝该上传
- **AND** 不创建 metadata、artifact record 或 event

#### Scenario: size/type limit 被拒绝

- **WHEN** 上传 payload 超过大小上限或 MIME/extension 不在 allowlist
- **THEN** Core 拒绝该上传
- **AND** 不写入 artifact 文件
