import { describe, expect, it } from "vitest";
import {
  WEB_V2_DEBUG_DETAIL_DEFAULT_OPEN,
  buildGateItems,
  buildRunMatrixRow,
  buildWorkbenchV2Model,
  deriveUnifiedComposerProjection,
  deriveRunUntilBlockedStopReason,
  type EventRecord,
  type TaskDetail,
  type TaskListItem
} from "./workbench-v2-model.js";

const baseTask: TaskListItem = {
  id: "task-1",
  projectId: "project-1",
  projectName: "coordinator",
  sourceKind: "manual",
  title: "Build Web V2",
  description: "replace old cockpit",
  autonomy: "supervised",
  requestedWorkflowProfile: "feature",
  status: "running",
  stateVersion: 3,
  updatedAt: "2026-05-26 10:00:00"
};

describe("workbench v2 display model", () => {
  it("为 Run Matrix row 提供稳定 E2E 与无 workflow fallback 字段", () => {
    const row = buildRunMatrixRow(baseTask);

    expect(row.dataTaskId).toBe("task-1");
    expect(row.ariaLabel).toBe("Open task Build Web V2");
    expect(row.workflow.stage).toBe("unknown");
    expect(row.workflow.substate).toBe("none");
    expect(row.workflow.handoff).toBe("none");
    expect(row.outerRail.map((node) => node.id)).toEqual(["task", "plan", "workspace", "workflow", "pr", "review", "merge"]);
  });

  it("Run Matrix agent summary 区分 inner 和 outer activity", () => {
    const detail = buildDetail({
      agentSessions: [
        {
          id: "inner-agent-1",
          providerKind: "codex",
          role: "inner",
          status: "completed",
          finalResponsePath: "coordinator/sessions/inner/final-response.md",
          activity: {
            state: "completed",
            providerId: "codex",
            eventCount: 1,
            artifactRefs: { finalResponsePath: "coordinator/sessions/inner/final-response.md" }
          }
        }
      ]
    });

    const row = buildRunMatrixRow(baseTask, detail);

    expect(row.agentSummary).toContain("inner codex / completed");
  });

  it("从现有 task detail 派生 Focus gate 与 queue metrics", () => {
    const detail = buildDetail({
      humanRequests: [
        {
          id: "hr-1",
          kind: "clarification",
          status: "pending",
          blockedKey: "scope",
          stateVersion: 1
        }
      ]
    });

    const model = buildWorkbenchV2Model({
      tasks: [baseTask],
      details: { [baseTask.id]: detail },
      projectId: "all",
      query: ""
    });

    expect(model.metrics).toMatchObject({ total: 1, needsMe: 1 });
    expect(model.rows[0]?.pin).toBe("needs-me");
    expect(model.inbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "human",
          taskId: "task-1",
          label: "Human request"
        })
      ])
    );
  });

  it("Core recovery attention 与 high-risk state 进入同一个 needs-me 派生路径", () => {
    const failedTask = { ...baseTask, id: "task-failed", status: "failed" };
    const failedWithoutDetail = buildRunMatrixRow(failedTask);
    const detail = buildDetail({
      task: failedTask,
      diagnosis: {
        currentBlocker: "provider auth missing",
        operatorAttention: { required: true, reasons: ["auth missing"] },
        retryBudget: { scheduledCount: 0, exhausted: true },
        operationLedger: [],
        recoveryTimeline: [],
        providerProtocolInspections: []
      }
    });

    expect(failedWithoutDetail.needsMe).toBe(true);
    expect(buildGateItems(failedWithoutDetail)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "attention",
          tone: "danger",
          label: "High risk"
        })
      ])
    );

    const model = buildWorkbenchV2Model({
      tasks: [failedTask],
      details: { [failedTask.id]: detail },
      projectId: "all",
      query: ""
    });

    expect(model.metrics).toMatchObject({ needsMe: 1, attention: 1 });
    expect(model.rows[0]?.pin).toBe("needs-me");
    expect(model.inbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "attention",
          tone: "danger",
          summary: "auth missing"
        })
      ])
    );
  });

  it("只把 PR/MR review required 或 conflict 放入 needs-me，不把普通 open PR 当成人工 gate", () => {
    const openPrDetail = buildDetail({
      latestPullRequest: {
        id: "pr-open",
        providerKind: "github",
        status: "open",
        reviewStatus: "approved",
        stateVersion: 1
      }
    });
    const reviewRequiredDetail = buildDetail({
      latestPullRequest: {
        id: "pr-review",
        providerKind: "github",
        status: "open",
        reviewStatus: "review_required",
        stateVersion: 1
      }
    });

    expect(buildRunMatrixRow(baseTask, openPrDetail).needsMe).toBe(false);
    expect(buildGateItems(buildRunMatrixRow(baseTask, openPrDetail)).some((item) => item.kind === "pr")).toBe(false);
    expect(buildRunMatrixRow(baseTask, reviewRequiredDetail).needsMe).toBe(true);
    expect(buildGateItems(buildRunMatrixRow(baseTask, reviewRequiredDetail))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pr",
          label: "PR / MR review"
        })
      ])
    );

    const conflictDetail = buildDetail({
      latestPullRequest: {
        id: "pr-conflict",
        providerKind: "github",
        status: "conflict",
        reviewStatus: "approved",
        stateVersion: 1
      }
    });

    expect(buildRunMatrixRow(baseTask, conflictDetail).needsMe).toBe(true);
    expect(buildGateItems(buildRunMatrixRow(baseTask, conflictDetail))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pr",
          summary: "conflict / approved"
        })
      ])
    );
  });

  it("不会把 materialize-change 这类 internal action 生成 needs-me", () => {
    const detail = buildDetail({
      events: [
        workflowEvent({
          status: {
            lifecycle: "active",
            status: "running",
            profile: "feature",
            stage: "implementation",
            substate: "materialize-change",
            allowedActions: ["materialize-change"],
            actionInputHints: {
              "materialize-change": { requiredArgs: ["change-id"], usage: "inner agent input" }
            }
          }
        })
      ]
    });

    const row = buildRunMatrixRow(baseTask, detail);

    expect(row.needsMe).toBe(false);
    expect(row.pin).toBe("running");
    expect(row.workflow.stage).toBe("implementation");
    expect(row.workflow.substate).toBe("materialize-change");
    expect(row.workflow.observation.mode).toBe("observing-runtime");
    expect(row.workflow.observation.agentInternalActions).toEqual(["materialize-change"]);
    expect(buildGateItems(row).some((item) => item.kind === "workflow")).toBe(false);
  });

  it("只为 operator-facing workflow gate 生成 needs-me item", () => {
    const detail = buildDetail({
      events: [
        workflowEvent({
          status: {
            lifecycle: "active",
            status: "running",
            stage: "requirements",
            substate: "freeze",
            allowedActions: ["freeze-requirements"]
          }
        })
      ]
    });

    const row = buildRunMatrixRow(baseTask, detail);

    expect(row.needsMe).toBe(true);
    expect(row.workflow.gate.operatorActions).toEqual(["freeze-requirements"]);
    expect(buildGateItems(row)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "workflow",
          label: "Requirements approval"
        })
      ])
    );
  });

  it("Debug Detail 默认折叠，由 Focus Drawer 内入口按需展开", () => {
    expect(WEB_V2_DEBUG_DETAIL_DEFAULT_OPEN).toBe(false);
  });

  it("Unified Composer mode 只响应 new task、human answer 和 note context", () => {
    expect(deriveUnifiedComposerProjection({}).mode).toBe("new-task");

    const humanDetail = buildDetail({
      humanRequests: [
        {
          id: "hr-composer",
          kind: "clarification",
          status: "pending",
          blockedKey: "scope",
          stateVersion: 1
        }
      ]
    });
    expect(deriveUnifiedComposerProjection({ selectedTask: baseTask, detail: humanDetail })).toMatchObject({
      mode: "human-answer",
      taskId: "task-1"
    });

    const internalWorkflowDetail = buildDetail({
      events: [
        workflowEvent({
          status: {
            lifecycle: "active",
            status: "running",
            allowedActions: ["materialize-change"]
          }
        })
      ]
    });
    expect(deriveUnifiedComposerProjection({ selectedTask: baseTask, detail: internalWorkflowDetail }).mode).toBe("task-note");
  });

  it("artifact refs 汇总包含 attachments 与 task note refs", () => {
    const detail = buildDetail({
      attachments: [
        {
          id: "attachment-1",
          projectId: "project-1",
          taskId: "task-1",
          artifactId: "artifact-1",
          artifactPath: "attachments/attachment-1/spec.md",
          originalFilename: "spec.md",
          safeFilename: "spec.md",
          mimeType: "text/markdown",
          sizeBytes: 42,
          actor: "web-operator",
          retentionKind: "task-local",
          createdAt: "2026-05-26 10:00:00"
        }
      ],
      taskNotes: [
        {
          eventId: 9,
          artifactPath: "task-notes/note.md",
          summary: "note",
          actor: "web-operator",
          createdAt: "2026-05-26 10:01:00"
        }
      ]
    });
    const row = buildRunMatrixRow(baseTask, detail);

    expect(row.artifactRefs).toEqual(
      expect.arrayContaining(["attachments/attachment-1/spec.md", "task-notes/note.md"])
    );
  });
});

describe("run until blocked stop reason", () => {
  it("把 active internal workflow runtime 展示为 observing-runtime", () => {
    const detail = buildDetail({
      events: [
        workflowEvent({
          status: {
            lifecycle: "active",
            status: "running",
            stage: "implementation",
            substate: "materialize-change",
            allowedActions: ["materialize-change"]
          }
        })
      ]
    });

    const stop = deriveRunUntilBlockedStopReason({
      detail,
      tick: { status: "ok", actions: [{ kind: "workflow", status: "observed" }] },
      tickIndex: 1,
      maxTicks: 8,
      scope: "task",
      taskId: detail.task.id
    });

    expect(stop).toMatchObject({
      stop: true,
      kind: "observing-runtime",
      scope: "task",
      taskId: "task-1"
    });
  });

  it("把 operator-facing workflow gate 展示为 waiting-operator-gate", () => {
    const detail = buildDetail({
      events: [
        workflowEvent({
          status: {
            lifecycle: "active",
            status: "running",
            stage: "requirements",
            substate: "freeze",
            allowedActions: ["freeze-requirements"]
          }
        })
      ]
    });

    const stop = deriveRunUntilBlockedStopReason({
      detail,
      tick: { status: "ok", actions: [{ kind: "workflow", status: "blocked" }] },
      tickIndex: 1,
      maxTicks: 8,
      scope: "task",
      taskId: detail.task.id
    });

    expect(stop.kind).toBe("waiting-operator-gate");
    expect(stop.summary).toBe("freeze-requirements");
  });

  it("workflow gate evidence missing 时 Run Until Blocked 继续等待 inner agent", () => {
    const detail = buildDetail({
      events: [
        workflowEvent({
          status: {
            lifecycle: "active",
            status: "running",
            stage: "requirements",
            substate: "freeze",
            allowedActions: ["freeze-requirements"]
          }
        })
      ]
    });

    const stop = deriveRunUntilBlockedStopReason({
      detail,
      gateEvidence: {
        workflowRunId: "workflow-1",
        taskId: "task-1",
        attemptId: "attempt-1",
        workflowRunStateVersion: 4,
        evidenceStatus: "missing",
        canSubmit: false,
        actionIds: ["freeze-requirements"],
        recentMessages: [],
        protocolFacts: {
          handoffAvailable: false,
          allowedActions: ["freeze-requirements"],
          operatorActions: ["freeze-requirements"],
          agentInternalActions: [],
          debugOnlyActions: [],
          deniedActions: [],
          stageArtifacts: []
        },
        supportingArtifacts: [],
        warnings: ["missing evidence"]
      },
      tick: { status: "ok", actions: [{ kind: "workflow", status: "blocked" }] },
      tickIndex: 1,
      maxTicks: 8,
      scope: "task",
      taskId: detail.task.id
    });

    expect(stop).toMatchObject({
      stop: false,
      kind: "observing-runtime",
      summary: "waiting for inner coding agent evidence"
    });
  });

  it("把 workflow handoff 展示为 handoff-ready，不用 stage/substate 推导完成态", () => {
    const detail = buildDetail({
      workflowRuns: [{ id: "workflow-1", profileId: "feature", status: "completed", handoffKind: "change-handoff", stateVersion: 4 }],
      events: [
        workflowEvent({
          status: {
            lifecycle: "completed",
            status: "completed",
            handoff: { available: true, kind: "change-handoff" }
          }
        })
      ]
    });

    const stop = deriveRunUntilBlockedStopReason({
      detail,
      tick: { status: "ok", actions: [{ kind: "workflow", status: "handoff" }] },
      tickIndex: 1,
      maxTicks: 8,
      scope: "task",
      taskId: detail.task.id
    });

    expect(stop.kind).toBe("handoff-ready");
  });

  it("把 Core recovery attention 展示为 recovery-attention", () => {
    const detail = buildDetail({
      diagnosis: {
        currentBlocker: "provider auth missing",
        operatorAttention: { required: true, reasons: ["auth missing"] },
        retryBudget: { scheduledCount: 0, exhausted: true },
        operationLedger: [],
        recoveryTimeline: [],
        providerProtocolInspections: []
      }
    });

    const stop = deriveRunUntilBlockedStopReason({
      detail,
      tick: { status: "ok", actions: [] },
      tickIndex: 1,
      maxTicks: 8,
      scope: "task",
      taskId: detail.task.id
    });

    expect(stop).toMatchObject({
      kind: "recovery-attention",
      summary: "auth missing"
    });
  });

  it("global run 只展示 queue 层 no-candidate 与 max-ticks", () => {
    expect(
      deriveRunUntilBlockedStopReason({
        tick: { status: "ok", actions: [] },
        tickIndex: 1,
        maxTicks: 8,
        scope: "global"
      }).kind
    ).toBe("no-candidate");

    expect(
      deriveRunUntilBlockedStopReason({
        tick: { status: "ok", actions: [{ kind: "task", status: "continued" }] },
        tickIndex: 8,
        maxTicks: 8,
        scope: "global"
      }).kind
    ).toBe("max-ticks");
  });
});

function buildDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    task: baseTask,
    project: {
      id: "project-1",
      name: "coordinator",
      repoPath: "/repo"
    },
    attempt: { id: "attempt-1", status: "running", reason: "test", stateVersion: 1 },
    executionPlan: { id: "plan-1", status: "ready", artifactPath: "artifacts/plan.md" },
    workspace: { id: "workspace-1", status: "ready", branch: "task/web-v2" },
    workflowRuns: [{ id: "workflow-1", profileId: "feature", status: "running", stateVersion: 4 }],
    agentSessions: [],
    pullRequests: [],
    humanRequests: [],
    attachments: [],
    taskNotes: [],
    events: [],
    surface: {
      surfaceKind: "operator_task_detail",
      json: {
        recommended_next_step: "observe",
        denied_actions: [],
        available_tools: [],
        artifact_root: "artifacts"
      },
      markdown: ""
    },
    currentBlocker: "workflow active",
    diagnosis: {
      currentBlocker: "workflow active",
      operatorAttention: { required: false, reasons: [] },
      retryBudget: { scheduledCount: 0, exhausted: false },
      operationLedger: [],
      recoveryTimeline: [],
      providerProtocolInspections: []
    },
    ...overrides
  };
}

function workflowEvent(payload: unknown): EventRecord {
  return {
    id: 1,
    type: "workflow.status",
    summary: "workflow status",
    severity: "info",
    workflowRunId: "workflow-1",
    payload,
    artifactRefs: [],
    createdAt: "2026-05-26 10:00:00"
  };
}
