CREATE TABLE IF NOT EXISTS task_attachments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  artifact_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  safe_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  actor TEXT NOT NULL,
  retention_kind TEXT NOT NULL DEFAULT 'task-local',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task_created
ON task_attachments(task_id, created_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_attachments_artifact_id
ON task_attachments(artifact_id);
