ALTER TABLE pull_requests ADD COLUMN title TEXT;
ALTER TABLE pull_requests ADD COLUMN body_artifact_path TEXT;
ALTER TABLE pull_requests ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE pull_requests ADD COLUMN review_summary TEXT;
ALTER TABLE pull_requests ADD COLUMN validation_run_id TEXT;
ALTER TABLE pull_requests ADD COLUMN merge_strategy TEXT;
ALTER TABLE pull_requests ADD COLUMN merged_at TEXT;

ALTER TABLE human_requests ADD COLUMN approval_pr_head_sha TEXT;
ALTER TABLE human_requests ADD COLUMN approval_pr_base_sha TEXT;
ALTER TABLE human_requests ADD COLUMN approval_validation_run_id TEXT;
ALTER TABLE human_requests ADD COLUMN approval_merge_strategy TEXT;
ALTER TABLE human_requests ADD COLUMN approval_valid INTEGER NOT NULL DEFAULT 1;
ALTER TABLE human_requests ADD COLUMN approved_by TEXT;
ALTER TABLE human_requests ADD COLUMN approved_at TEXT;

CREATE INDEX IF NOT EXISTS idx_pull_requests_task_status ON pull_requests(task_id, status);
CREATE INDEX IF NOT EXISTS idx_pull_requests_attempt_status ON pull_requests(attempt_id, status);
