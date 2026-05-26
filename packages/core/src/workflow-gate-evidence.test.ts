import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendEvent,
  createAgentSession,
  createAttempt,
  createProject,
  createTask,
  createWorkflowRun,
  runMigrations,
  withDatabase
} from "@coordinator/db";
import { buildWorkflowGateEvidence } from "./index.js";

function createMigratedDatabase(): string {
  const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-gate-evidence-db-")), "gate-evidence.sqlite");
  runMigrations(databasePath);
  return databasePath;
}

describe("workflow gate evidence", () => {
  it("使用 inner agent final response 形成 ready evidence", () => {
    const databasePath = createMigratedDatabase();
    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-gate-evidence", name: "gate evidence" });
      const task = createTask(context, { id: "task-gate-evidence", projectId: project.id, title: "gate evidence" });
      const attempt = createAttempt(context, { id: "attempt-gate-evidence", projectId: project.id, taskId: task.id });
      const run = createWorkflowRun(context, {
        id: "workflow-gate-evidence",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        profileId: "feature",
        status: "running",
        externalId: "inner-run"
      });
      appendEvent(context, {
        type: "workflow.status_inspected",
        summary: "workflow waits for requirements",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        workflowRunId: run.id,
        payload: {
          lifecycle: "active",
          summary: "requirements ready",
          progress: { label: "Requirements", summary: "需求待确认" },
          debug: { stage: "requirements", substate: "freeze", allowedActions: ["freeze-requirements"], deniedActions: [] },
          handoff: { available: false, artifacts: [], deniedActions: [] },
          stageArtifacts: [{ kind: "requirements", path: ".workflow/runs/inner-run/artifacts/requirements.md" }]
        }
      });
      const root = mkdtempSync(join(tmpdir(), "coordinator-gate-evidence-agent-"));
      const finalResponsePath = join(root, "final-response.md");
      writeFileSync(finalResponsePath, "需求范围：报名页前端缓存。请确认冻结需求。", "utf8");
      createAgentSession(context, {
        id: "inner-agent-gate-evidence",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        providerKind: "codex",
        role: "inner",
        status: "completed",
        finalResponsePath
      });
      return buildWorkflowGateEvidence(context, { workflowRunId: run.id });
    });

    expect(result).toMatchObject({
      evidenceStatus: "ready",
      canSubmit: true,
      primaryAction: "freeze-requirements",
      protocolFacts: { stage: "requirements", progressLabel: "Requirements" }
    });
    expect(result.primaryMessage?.text).toContain("报名页前端缓存");
    expect(result.supportingArtifacts).toContain(".workflow/runs/inner-run/artifacts/requirements.md");
  });

  it("没有 inner agent visible output 时标记 missing evidence", () => {
    const databasePath = createMigratedDatabase();
    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-missing-evidence", name: "missing evidence" });
      const task = createTask(context, { id: "task-missing-evidence", projectId: project.id, title: "missing evidence" });
      const attempt = createAttempt(context, { id: "attempt-missing-evidence", projectId: project.id, taskId: task.id });
      const run = createWorkflowRun(context, {
        id: "workflow-missing-evidence",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        profileId: "feature",
        status: "running",
        externalId: "inner-run"
      });
      appendEvent(context, {
        type: "workflow.status_inspected",
        summary: "workflow waits for requirements",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        workflowRunId: run.id,
        payload: {
          lifecycle: "active",
          debug: { stage: "requirements", allowedActions: ["freeze-requirements"] },
          handoff: { available: false, artifacts: [], deniedActions: [] }
        }
      });
      return buildWorkflowGateEvidence(context, { workflowRunId: run.id });
    });

    expect(result.evidenceStatus).toBe("missing");
    expect(result.canSubmit).toBe(false);
    expect(result.warnings.join(" ")).toContain("缺少 inner coding agent");
  });

  it("只把 completed 或 stopped inner session 作为可提交 evidence", () => {
    const databasePath = createMigratedDatabase();
    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-status-evidence", name: "status evidence" });
      const task = createTask(context, { id: "task-status-evidence", projectId: project.id, title: "status evidence" });
      const attempt = createAttempt(context, { id: "attempt-status-evidence", projectId: project.id, taskId: task.id });
      const run = createWorkflowRun(context, {
        id: "workflow-status-evidence",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        profileId: "feature",
        status: "running",
        externalId: "inner-run"
      });
      appendEvent(context, {
        type: "workflow.status_inspected",
        summary: "workflow waits for requirements",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        workflowRunId: run.id,
        payload: {
          lifecycle: "active",
          debug: { stage: "requirements", allowedActions: ["freeze-requirements"] },
          handoff: { available: false, artifacts: [], deniedActions: [] }
        }
      });
      const stoppedPath = join(mkdtempSync(join(tmpdir(), "coordinator-stopped-agent-")), "final-response.md");
      writeFileSync(stoppedPath, "我已停止等待你确认需求。", "utf8");
      createAgentSession(context, {
        id: "inner-agent-stopped-evidence",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        providerKind: "codex",
        role: "inner",
        status: "stopped",
        finalResponsePath: stoppedPath
      });
      return buildWorkflowGateEvidence(context, { workflowRunId: run.id });
    });

    expect(result.evidenceStatus).toBe("ready");
    expect(result.canSubmit).toBe(true);
  });

  it("stalled inner session 只能形成 partial evidence，不能提交 human gate", () => {
    const databasePath = createMigratedDatabase();
    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-stalled-evidence", name: "stalled evidence" });
      const task = createTask(context, { id: "task-stalled-evidence", projectId: project.id, title: "stalled evidence" });
      const attempt = createAttempt(context, { id: "attempt-stalled-evidence", projectId: project.id, taskId: task.id });
      const run = createWorkflowRun(context, {
        id: "workflow-stalled-evidence",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        profileId: "feature",
        status: "running",
        externalId: "inner-run"
      });
      appendEvent(context, {
        type: "workflow.status_inspected",
        summary: "workflow waits for requirements",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        workflowRunId: run.id,
        payload: {
          lifecycle: "active",
          debug: { stage: "requirements", allowedActions: ["freeze-requirements"] },
          handoff: { available: false, artifacts: [], deniedActions: [] }
        }
      });
      const stalledPath = join(mkdtempSync(join(tmpdir(), "coordinator-stalled-agent-")), "final-response.md");
      writeFileSync(stalledPath, "我还在阻塞态，不能作为确认依据。", "utf8");
      createAgentSession(context, {
        id: "inner-agent-stalled-evidence",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        providerKind: "codex",
        role: "inner",
        status: "stalled",
        finalResponsePath: stalledPath
      });
      return buildWorkflowGateEvidence(context, { workflowRunId: run.id });
    });

    expect(result.evidenceStatus).toBe("partial");
    expect(result.canSubmit).toBe(false);
  });

  it("不会用最近 workflow action 之前的 inner final response 确认新 gate", () => {
    const databasePath = createMigratedDatabase();
    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-stale-evidence", name: "stale evidence" });
      const task = createTask(context, { id: "task-stale-evidence", projectId: project.id, title: "stale evidence" });
      const attempt = createAttempt(context, { id: "attempt-stale-evidence", projectId: project.id, taskId: task.id });
      const run = createWorkflowRun(context, {
        id: "workflow-stale-evidence",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        profileId: "feature",
        status: "running",
        externalId: "inner-run"
      });
      const oldPath = join(mkdtempSync(join(tmpdir(), "coordinator-old-agent-")), "final-response.md");
      writeFileSync(oldPath, "上一轮需求已确认。", "utf8");
      createAgentSession(context, {
        id: "inner-agent-old-evidence",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        providerKind: "codex",
        role: "inner",
        status: "completed",
        finalResponsePath: oldPath
      });
      context.db
        .prepare("UPDATE agent_sessions SET created_at = ?, updated_at = ? WHERE id = ?")
        .run("2026-05-01 00:00:00", "2026-05-01 00:00:00", "inner-agent-old-evidence");
      appendEvent(context, {
        type: "workflow.action",
        summary: "freeze requirements executed",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        workflowRunId: run.id,
        payload: { action: "freeze-requirements" }
      });
      appendEvent(context, {
        type: "workflow.status_inspected",
        summary: "workflow waits for review approval",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        workflowRunId: run.id,
        payload: {
          lifecycle: "active",
          debug: { stage: "review", allowedActions: ["approve-review"] },
          handoff: { available: false, artifacts: [], deniedActions: [] }
        }
      });
      return buildWorkflowGateEvidence(context, { workflowRunId: run.id, action: "approve-review" });
    });

    expect(result.evidenceStatus).toBe("missing");
    expect(result.canSubmit).toBe(false);
    expect(result.warnings.join(" ")).toContain("已忽略早于最近 workflow action");
  });
});
