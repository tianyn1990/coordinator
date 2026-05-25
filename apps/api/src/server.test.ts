import { describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  createAttempt,
  createHumanRequest,
  createOperation,
  createProject,
  createTask,
  createWorkspace,
  createWorkflowRun,
  listTaskEvents,
  runMigrations,
  updateOperation,
  withDatabase
} from "@coordinator/db";
import { buildServer } from "./server.js";

describe("API health", () => {
  it("返回 coordinator 健康状态", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "coordinator"
    });
  });

  it("支持 Web operator surface 的 CORS preflight", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "OPTIONS",
      url: "/tasks",
      headers: { origin: "http://127.0.0.1:5173" }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
  });

  it("按 task id 返回 event timeline", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-")), "api.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, { name: "coordinator" });
      createTask(context, { id: "task-api-timeline", projectId: project.id, title: "api timeline" });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({ method: "GET", url: "/tasks/task-api-timeline/timeline" });

      expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
      expect(response.json()).toMatchObject({
        taskId: "task-api-timeline",
        events: [{ type: "task.created" }]
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("可以查看 project registry", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-projects-")), "api.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      createProject(context, {
        id: "project-api",
        name: "coordinator",
        defaultBranch: "main",
        workflowLauncher: "workflow"
      });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({ method: "GET", url: "/projects" });

      expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
      expect(response.json()).toMatchObject({
        projects: [{ id: "project-api", defaultBranch: "main" }]
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("Web API 可注册 project registry 并返回工程配置", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-register-project-")), "api.sqlite");
    const repoPath = mkdtempSync(join(tmpdir(), "coordinator-api-register-repo-"));
    runMigrations(databasePath);
    execFileSync("git", ["init"], { cwd: repoPath });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:example/project.git"], { cwd: repoPath });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/projects/register",
        payload: {
          repoPath,
          name: "registered-web-project",
          confirmedDefaultBranch: "main",
          workflowLauncher: "workflow",
          outerAgentDefaultProvider: "codex",
          innerAgentDefaultProvider: "codex",
          workspaceRoot: mkdtempSync(join(tmpdir(), "coordinator-api-register-workspaces-"))
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        blocked: false,
        project: {
          name: "registered-web-project",
          gitProviderKind: "github",
          defaultBranch: "main",
          registrationStatus: "registered"
        }
      });

      const listed = await server.inject({ method: "GET", url: "/projects" });
      expect(listed.json()).toMatchObject({
        projects: [expect.objectContaining({ name: "registered-web-project", workflowLauncher: "workflow" })]
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("Web API 可创建 manual task 并查看 task list/detail", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-web-task-")), "api.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      createProject(context, {
        id: "project-api-web",
        name: "web",
        workspaceRoot: mkdtempSync(join(tmpdir(), "coordinator-api-web-workspaces-"))
      });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const created = await server.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          projectId: "project-api-web",
          title: "Web manual task",
          description: "from UI",
          autonomy: "balanced",
          requestedWorkflowProfile: "feature"
        }
      });
      expect(created.statusCode).toBe(200);
      expect(created.json()).toMatchObject({
        task: { sourceKind: "manual", title: "Web manual task", requestedWorkflowProfile: "feature" }
      });

      const listed = await server.inject({ method: "GET", url: "/tasks" });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toMatchObject({
        tasks: [{ title: "Web manual task", projectName: "web", requestedWorkflowProfile: "feature" }]
      });

      const detail = await server.inject({ method: "GET", url: `/tasks/${created.json().task.id}` });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        task: { title: "Web manual task", requestedWorkflowProfile: "feature" },
        diagnosis: {
          currentBlocker: "created",
          operatorAttention: { required: false }
        },
        surface: {
          json: {
            available_tools: [{ name: "write_execution_plan" }, { name: "ask_human" }]
          }
        }
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("task detail API 返回 operator-only diagnosis 摘要", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-diagnosis-")), "api.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-api-diagnosis", name: "diagnosis" });
      const task = createTask(context, { id: "task-api-diagnosis", projectId: project.id, title: "diagnosis" });
      const attempt = createAttempt(context, { id: "attempt-api-diagnosis", projectId: project.id, taskId: task.id });
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("run-api", project.id, task.id, attempt.id, "feature", "unknown", "inner-run-api");
      const operation = createOperation(context, {
        id: "operation-api-diagnosis",
        idempotencyKey: "daemon:api-diagnosis",
        kind: "daemon:workflow:inspect",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "unknown",
        lastObservedState: {
          decision: "operator_attention",
          reasonCode: "workflow-profile-mismatch",
          observedSummary: "profile mismatch",
          lockToken: "must-not-leak"
        }
      });
      context.db
        .prepare(
          `INSERT INTO events (type, summary, project_id, task_id, attempt_id, workflow_run_id, operation_id, severity, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "daemon.recovery_decision",
          "workflow-profile-mismatch: workflow_run:run-api",
          project.id,
          task.id,
          attempt.id,
          "run-api",
          operation.id,
          "warn",
          JSON.stringify({
            resourceKind: "workflow_run",
            resourceId: "run-api",
            operationId: operation.id,
            decision: "operator_attention",
            reasonCode: "workflow-profile-mismatch",
            observedSummary: "workflow protocol profile mismatch",
            nextAction: "operator_review",
            operatorAttentionRequired: true,
            lockToken: "must-not-leak"
          })
        );
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({ method: "GET", url: "/tasks/task-api-diagnosis" });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.diagnosis).toMatchObject({
        operatorAttention: {
          required: true,
          reasons: expect.arrayContaining(["workflow-profile-mismatch"])
        },
        operationLedger: [{ id: "operation-api-diagnosis", lastReasonCode: "workflow-profile-mismatch" }],
        recoveryTimeline: [{ reasonCode: "workflow-profile-mismatch", nextAction: "operator_review" }]
      });
      expect(JSON.stringify(body.diagnosis)).not.toContain("must-not-leak");
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("task summary API 返回 operator-only execution summary", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-summary-")), "api.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-api-summary", name: "summary" });
      createTask(context, { id: "task-api-summary", projectId: project.id, title: "summary" });
    });
    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    const server = buildServer();
    try {
      const response = await server.inject({ method: "GET", url: "/tasks/task-api-summary/summary" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        task: { id: "task-api-summary", title: "summary" },
        nextStep: { availableTools: ["write_execution_plan", "ask_human"] }
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("Web API 可回答 human request，并把正文写入 artifact", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-human-answer-")), "api.sqlite");
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-api-human-workspaces-"));
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-human",
        name: "human",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-api-human", projectId: project.id, title: "human" });
      createHumanRequest(context, {
        id: "human-api-answer",
        projectId: project.id,
        taskId: task.id,
        blockedKey: "agent:requirements",
        kind: "requirements-clarification",
        status: "pending"
      });
      context.db
        .prepare("UPDATE tasks SET status = ?, state_version = state_version + 1 WHERE id = ?")
        .run("waiting_human", task.id);
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/human-requests/human-api-answer/answer",
        payload: {
          expectedStateVersion: 0,
          answer: "继续执行。",
          answeredBy: "api-test"
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { humanRequest: { status: string }; artifactPath: string };
      expect(body.humanRequest).toMatchObject({ status: "answered" });
      expect(body.artifactPath).toMatch(/^human-answers\/human-api-answer-v0-.+\.md$/);
      expect(
        existsSync(
          join(
            workspaceRoot,
            "project-api-human",
            "task-api-human",
            "_task",
            "coordinator",
            "artifacts",
            body.artifactPath
          )
        )
      ).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("Web API 可通过 Core runtime 执行 operator task control", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-task-control-")), "api.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-api-control", name: "control" });
      createTask(context, { id: "task-api-control", projectId: project.id, title: "control" });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/tasks/task-api-control/control",
        payload: {
          action: "pause",
          expectedStateVersion: 0,
          reason: "api pause",
          actor: "api-test"
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        action: "pause",
        previousStatus: "created",
        nextStatus: "paused",
        task: { status: "paused" }
      });
      const events = withDatabase(databasePath, (context) => listTaskEvents(context, "task-api-control"));
      expect(events.map((event) => event.type)).toContain("operator.task_paused");
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("注册 API 拒绝非法 providerOverride", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-register-")), "api.sqlite");
    runMigrations(databasePath);

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/projects/register",
        payload: {
          repoPath: "/tmp/repo",
          providerOverride: "bitbucket",
          confirmedDefaultBranch: "main"
        }
      });

      expect(response.statusCode).toBe(400);
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("workflow start API 把 auto 语义委托给 runtime", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-workflow-start-")), "api.sqlite");
    const repoPath = mkdtempSync(join(tmpdir(), "coordinator-api-workflow-repo-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-api-workflow-workspaces-"));
    const launcherPath = join(mkdtempSync(join(tmpdir(), "coordinator-api-workflow-launcher-")), "workflow");
    writeFileSync(
      launcherPath,
      `#!/bin/sh
set -eu
if [ "$1" = "protocol" ] && [ "$2" = "start" ]; then
  if printf '%s' "$@" | grep -Eq -- '--workflow[[:space:]]+(auto|default)'; then
    echo 'should not pass auto/default as concrete workflow' >&2
    exit 1
  fi
  cat <<'JSON'
{"runId":"inner-run-1","profile":"feature","lifecycle":"active","handoff":{"available":false,"artifacts":[],"deniedActions":[]},"summary":"started"}
JSON
  exit 0
fi
echo "unexpected args: $*" >&2
exit 1
`
    );
    chmodSync(launcherPath, 0o755);
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-workflow-start",
        name: "workflow",
        repoPath,
        workspaceRoot,
        workflowLauncher: launcherPath
      });
      const task = createTask(context, { id: "task-api-workflow-start", projectId: project.id, title: "workflow" });
      const attempt = createAttempt(context, { id: "attempt-api-workflow-start", projectId: project.id, taskId: task.id });
      const workspacePath = join(workspaceRoot, project.id, task.id, attempt.id);
      const repoWorktree = join(workspacePath, "repo");
      mkdirSync(join(repoWorktree, ".git"), { recursive: true });
      createWorkspace(context, {
        id: "workspace-api-workflow-start",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        status: "ready",
        workspacePath,
        repoPath: repoWorktree,
        branch: "coordinator/task-api-workflow-start/attempt-api-workflow-start",
        baseBranch: "main"
      });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/attempts/attempt-api-workflow-start/workflow-runs",
        payload: { profileId: "auto", owner: "api-test" }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        workflowRun: {
          selectionSource: "runtime_auto",
          requestedProfileAlias: "auto",
          profileId: "feature"
        }
      });
      expect(body.workflowRun).not.toHaveProperty("requestedProfileId");
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("workflow actions API 经 Core 校验后执行 operator-confirmed action", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-workflow-action-")), "api.sqlite");
    const repoPath = mkdtempSync(join(tmpdir(), "coordinator-api-workflow-action-repo-"));
    mkdirSync(join(repoPath, ".git"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-api-workflow-action-workspaces-"));
    const launcherPath = join(mkdtempSync(join(tmpdir(), "coordinator-api-workflow-action-launcher-")), "workflow");
    writeFileSync(
      launcherPath,
      `#!/bin/sh
set -eu
if [ "$1" = "protocol" ] && [ "$2" = "status" ]; then
  cat <<'JSON'
{"runId":"inner-run-1","profile":"feature","lifecycle":"active","stage":"requirements","allowedActions":["freeze-requirements"],"handoff":{"available":false,"artifacts":[],"deniedActions":[]},"summary":"waiting for operator"}
JSON
  exit 0
fi
if [ "$1" = "protocol" ] && [ "$2" = "action" ] && [ "$5" = "freeze-requirements" ]; then
  cat <<'JSON'
{"runId":"inner-run-1","profile":"feature","lifecycle":"active","stage":"implementation","allowedActions":[],"handoff":{"available":false,"artifacts":[],"deniedActions":[]},"summary":"requirements frozen"}
JSON
  exit 0
fi
echo "unexpected args: $*" >&2
exit 1
`
    );
    chmodSync(launcherPath, 0o755);
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-workflow-action",
        name: "workflow-action",
        repoPath,
        workspaceRoot,
        workflowLauncher: launcherPath
      });
      const task = createTask(context, { id: "task-api-workflow-action", projectId: project.id, title: "workflow action" });
      const attempt = createAttempt(context, { id: "attempt-api-workflow-action", projectId: project.id, taskId: task.id });
      const workspacePath = join(workspaceRoot, project.id, task.id, attempt.id);
      const repoWorktree = join(workspacePath, "repo");
      mkdirSync(join(repoWorktree, ".git"), { recursive: true });
      createWorkspace(context, {
        id: "workspace-api-workflow-action",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        status: "ready",
        workspacePath,
        repoPath: repoWorktree,
        branch: "coordinator/task-api-workflow-action/attempt-api-workflow-action",
        baseBranch: "main"
      });
      createWorkflowRun(context, {
        id: "workflow-run-api-action",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        profileId: "feature",
        status: "running",
        externalId: "inner-run-1"
      });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/workflow-runs/workflow-run-api-action/actions",
        payload: { action: "freeze-requirements", expectedStateVersion: 0, actor: "api-test" }
      });

      expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
      expect(response.json()).toMatchObject({
        workflowRun: { id: "workflow-run-api-action", status: "running", stateVersion: 1 },
        status: {
          debug: { stage: "implementation" },
          summary: "requirements frozen"
        }
      });
      const events = withDatabase(databasePath, (context) => listTaskEvents(context, "task-api-workflow-action"));
      expect(events.map((event) => event.type)).toContain("workflow.action");
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("legacy workflow action API 也必须经 Core allowedActions 校验", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-workflow-action-legacy-")), "api.sqlite");
    const repoPath = mkdtempSync(join(tmpdir(), "coordinator-api-workflow-action-legacy-repo-"));
    mkdirSync(join(repoPath, ".git"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-api-workflow-action-legacy-workspaces-"));
    const launcherPath = join(mkdtempSync(join(tmpdir(), "coordinator-api-workflow-action-legacy-launcher-")), "workflow");
    writeFileSync(
      launcherPath,
      `#!/bin/sh
set -eu
if [ "$1" = "protocol" ] && [ "$2" = "status" ]; then
  cat <<'JSON'
{"runId":"inner-run-1","profile":"feature","lifecycle":"active","stage":"requirements","allowedActions":["freeze-requirements"],"handoff":{"available":false,"artifacts":[],"deniedActions":[]},"summary":"waiting for operator"}
JSON
  exit 0
fi
if [ "$1" = "protocol" ] && [ "$2" = "action" ]; then
  echo "legacy endpoint bypassed allowedActions" >&2
  exit 1
fi
echo "unexpected args: $*" >&2
exit 1
`
    );
    chmodSync(launcherPath, 0o755);
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-workflow-action-legacy",
        name: "workflow-action-legacy",
        repoPath,
        workspaceRoot,
        workflowLauncher: launcherPath
      });
      const task = createTask(context, { id: "task-api-workflow-action-legacy", projectId: project.id, title: "workflow action legacy" });
      const attempt = createAttempt(context, { id: "attempt-api-workflow-action-legacy", projectId: project.id, taskId: task.id });
      const workspacePath = join(workspaceRoot, project.id, task.id, attempt.id);
      const repoWorktree = join(workspacePath, "repo");
      mkdirSync(join(repoWorktree, ".git"), { recursive: true });
      createWorkspace(context, {
        id: "workspace-api-workflow-action-legacy",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        status: "ready",
        workspacePath,
        repoPath: repoWorktree,
        branch: "coordinator/task-api-workflow-action-legacy/attempt-api-workflow-action-legacy",
        baseBranch: "main"
      });
      createWorkflowRun(context, {
        id: "workflow-run-api-action-legacy",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        profileId: "feature",
        status: "running",
        externalId: "inner-run-1"
      });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/workflow-runs/workflow-run-api-action-legacy/action",
        payload: { action: "unsafe-action", expectedStateVersion: 0, actor: "api-test" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: expect.stringContaining("latest allowedActions") });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("可以查看 task surface", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-surface-")), "api.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-surface-api",
        name: "coordinator",
        defaultBranch: "main",
        workflowLauncher: "workflow"
      });
      createTask(context, {
        id: "task-surface-api",
        projectId: project.id,
        title: "surface api",
        description: "surface",
        autonomy: "balanced"
      });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({ method: "GET", url: "/tasks/task-surface-api/surface" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        surfaceKind: "bootstrap",
        json: {
          surface_kind: "bootstrap",
          available_tools: [{ name: "write_execution_plan" }, { name: "ask_human" }]
        }
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("workspace preflight API 可报告缺失 workspace record", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-workspace-")), "api.sqlite");
    runMigrations(databasePath);

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({ method: "GET", url: "/workspaces/missing-workspace/preflight" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "retryable",
        checks: [{ name: "workspace-record" }]
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("workspace create API 缺少 attempt 时返回受控错误", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-workspace-")), "api.sqlite");
    runMigrations(databasePath);

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/attempts/missing-attempt/workspace",
        payload: { owner: "api-test" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "attempt not found: missing-attempt" });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("agent session API 可通过 fake provider 启动并查询", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-agent-")), "api.sqlite");
    const repoPath = mkdtempSync(join(tmpdir(), "coordinator-api-agent-repo-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-api-agent-workspaces-"));
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-agent",
        name: "agent",
        repoPath,
        workspaceRoot,
        outerAgentDefaultProvider: "fake"
      });
      createTask(context, { id: "task-api-agent", projectId: project.id, title: "agent api" });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const created = await server.inject({
        method: "POST",
        url: "/tasks/task-api-agent/agent-sessions",
        payload: { providerId: "fake" }
      });

      expect(created.statusCode).toBe(200);
      const body = created.json();
      expect(body.session).toMatchObject({ taskId: "task-api-agent", providerKind: "fake", status: "completed" });

      const inspected = await server.inject({ method: "GET", url: `/agent-sessions/${body.session.id}` });
      expect(inspected.statusCode).toBe(200);
      expect(inspected.json()).toMatchObject({
        session: { id: body.session.id },
        artifacts: { finalResponsePath: body.artifacts.finalResponsePath }
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("agent tools API 是 operator 调试入口，可执行 write_execution_plan", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-tools-")), "tools.sqlite");
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-api-tools-workspaces-"));
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-tools",
        name: "tools",
        workspaceRoot
      });
      createTask(context, { id: "task-api-tools", projectId: project.id, title: "tools api" });
    });
    const artifactRoot = join(workspaceRoot, "project-api-tools", "task-api-tools", "_task", "coordinator", "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(artifactRoot, "execution-plan.md"), "# Plan\n");

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/tasks/task-api-tools/agent-tools",
        payload: {
          toolName: "write_execution_plan",
          args: { artifact: "execution-plan.md" }
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        toolName: "write_execution_plan",
        status: "succeeded"
      });

      const surface = await server.inject({ method: "GET", url: "/tasks/task-api-tools/surface" });
      expect(surface.json().json.available_tools.map((tool: { name: string }) => tool.name)).not.toContain("agent-tool execute");
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("daemon tick API 是 operator 调试入口，不进入 Coordinator Surface", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-daemon-")), "daemon.sqlite");
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-api-daemon-workspaces-"));
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-daemon",
        name: "daemon",
        workspaceRoot,
        outerAgentDefaultProvider: "fake"
      });
      createTask(context, { id: "task-api-daemon", projectId: project.id, title: "daemon api" });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/daemon/tick",
        payload: { owner: "api-test" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "acted",
        actions: expect.arrayContaining([expect.objectContaining({ kind: "agent_tool_skipped" })])
      });

      const surface = await server.inject({ method: "GET", url: "/tasks/task-api-daemon/surface" });
      expect(surface.json().json.available_tools.map((tool: { name: string }) => tool.name)).not.toContain("daemon tick");
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("daemon tick API 支持 task-scoped operator 推进", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-daemon-scope-")), "daemon.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-daemon-scope",
        name: "daemon-scope",
        outerAgentDefaultProvider: "fake"
      });
      createTask(context, { id: "task-api-daemon-scope-a", projectId: project.id, title: "scope a" });
      createTask(context, { id: "task-api-daemon-scope-b", projectId: project.id, title: "scope b" });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/daemon/tick",
        payload: { owner: "api-test", taskId: "task-api-daemon-scope-b" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "acted",
        actions: [expect.objectContaining({ kind: "agent_tool_skipped", taskId: "task-api-daemon-scope-b" })]
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("PR/MR API 入口存在且是 operator-only", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-pr-")), "pr.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-pr",
        name: "pr",
        repoPath: mkdtempSync(join(tmpdir(), "coordinator-api-pr-repo-")),
        defaultBranch: "main",
        prProviderKind: "github"
      });
      createTask(context, { id: "task-api-pr", projectId: project.id, title: "pr api" });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/tasks/task-api-pr/pull-requests",
        payload: {
          title: "PR",
          bodyArtifact: "body.md"
        }
      });

      expect(response.statusCode).toBe(400);
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });
});
