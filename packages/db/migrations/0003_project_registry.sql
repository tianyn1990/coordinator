ALTER TABLE projects ADD COLUMN git_provider_host TEXT;
ALTER TABLE projects ADD COLUMN pr_provider_kind TEXT;
ALTER TABLE projects ADD COLUMN workspace_root TEXT;
ALTER TABLE projects ADD COLUMN workflow_launcher TEXT;
ALTER TABLE projects ADD COLUMN outer_agent_default_provider TEXT;
ALTER TABLE projects ADD COLUMN inner_agent_default_provider TEXT;
ALTER TABLE projects ADD COLUMN registration_status TEXT NOT NULL DEFAULT 'registered';
ALTER TABLE projects ADD COLUMN registry_notes_json TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_registration_status ON projects(registration_status);
