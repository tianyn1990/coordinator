ALTER TABLE workflow_runs ADD COLUMN selection_source TEXT NOT NULL DEFAULT 'human_explicit';
ALTER TABLE workflow_runs ADD COLUMN requested_profile_id TEXT;
ALTER TABLE workflow_runs ADD COLUMN requested_profile_alias TEXT;

UPDATE workflow_runs
SET
  selection_source = CASE
    WHEN profile_id IN ('default', 'auto') THEN 'runtime_auto'
    ELSE 'human_explicit'
  END,
  requested_profile_id = CASE
    WHEN profile_id IN ('default', 'auto') THEN NULL
    ELSE profile_id
  END,
  requested_profile_alias = CASE
    WHEN profile_id IN ('default', 'auto') THEN profile_id
    ELSE requested_profile_alias
  END
WHERE requested_profile_id IS NULL OR requested_profile_alias IS NULL OR selection_source IS NULL;
