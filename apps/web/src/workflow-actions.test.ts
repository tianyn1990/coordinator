import { describe, expect, it } from "vitest";
import {
  buildWorkflowGateEvidenceRefreshKey,
  buildWorkflowGateInboxItem,
  groupWorkflowActions,
  summarizeWorkflowGate,
  workflowActionButtonLabel,
  workflowGateEvidenceCanSubmit,
  workflowGateEvidenceStatusLabel
} from "./workflow-actions.js";

describe("web workflow action helpers", () => {
  it("只把 operator-facing action 放入可操作分组", () => {
    expect(groupWorkflowActions(["freeze-requirements", "materialize-change", "debug-only"])).toEqual({
      operatorFacing: ["freeze-requirements"],
      agentInternal: ["materialize-change"],
      debugOnly: ["debug-only"]
    });
  });

  it("为 operator-facing action 提供明确按钮文案", () => {
    expect(workflowActionButtonLabel("freeze-requirements")).toBe("Approve requirements and continue");
    expect(workflowActionButtonLabel("approve-planning-dossier")).toBe("Approve plan and continue");
  });

  it("只有 operator-facing workflow gate 会进入 needs-me 摘要", () => {
    expect(summarizeWorkflowGate(["freeze-requirements"])).toMatchObject({
      hasOperatorGate: true,
      operatorActions: ["freeze-requirements"],
      label: "Requirements approval"
    });
    expect(summarizeWorkflowGate(["materialize-change"])).toMatchObject({
      hasOperatorGate: false,
      summary: "observing internal/debug workflow action"
    });
    expect(summarizeWorkflowGate(["unknown-action"])).toMatchObject({
      hasOperatorGate: false,
      summary: "observing internal/debug workflow action"
    });
  });

  it("优先使用 Core workflow observation 判断 needs-me", () => {
    expect(
      summarizeWorkflowGate(["materialize-change"], {
        mode: "observing-runtime",
        owner: "workflow-runtime",
        reason: "workflow runtime active",
        summary: "implementation continues",
        operatorActions: [],
        agentInternalActions: ["materialize-change"],
        debugOnlyActions: [],
        deniedActions: [],
        handoffAvailable: false,
        actionInputHints: {
          "materialize-change": { requiredArgs: ["change-id"] }
        }
      })
    ).toMatchObject({
      hasOperatorGate: false,
      summary: "observing internal/debug workflow action"
    });
    expect(
      buildWorkflowGateInboxItem({
        taskId: "task-3",
        projectName: "coordinator",
        title: "requirements gate",
        observation: {
          mode: "waiting-operator-gate",
          owner: "operator",
          reason: "workflow waits for operator gate",
          summary: "freeze requirements",
          operatorActions: ["freeze-requirements"],
          agentInternalActions: [],
          debugOnlyActions: [],
          deniedActions: [],
          handoffAvailable: false,
          actionInputHints: {}
        }
      })
    ).toMatchObject({ kind: "workflow", label: "Requirements approval" });
  });

  it("非 operator gate observation 即使携带 stale operator action 也不进入 needs-me", () => {
    expect(
      summarizeWorkflowGate(["freeze-requirements"], {
        mode: "handoff-ready",
        owner: "coordinator",
        reason: "workflow handoff ready",
        summary: "handoff ready",
        operatorActions: ["freeze-requirements"],
        agentInternalActions: [],
        debugOnlyActions: [],
        deniedActions: [],
        handoffAvailable: true,
        handoffKind: "pr_ready",
        actionInputHints: {}
      })
    ).toMatchObject({
      hasOperatorGate: false,
      operatorActions: [],
      summary: "handoff-ready"
    });
    expect(
      buildWorkflowGateInboxItem({
        taskId: "task-stale",
        projectName: "coordinator",
        title: "handoff ready",
        actionIds: ["freeze-requirements"],
        observation: {
          mode: "recovery-attention",
          owner: "recovery",
          reason: "workflow requires recovery",
          summary: "recovery",
          operatorActions: ["freeze-requirements"],
          agentInternalActions: [],
          debugOnlyActions: [],
          deniedActions: [],
          handoffAvailable: false,
          actionInputHints: {}
        }
      })
    ).toBeUndefined();
  });

  it("Action Inbox 只为 operator-facing workflow gate 生成 item", () => {
    expect(
      buildWorkflowGateInboxItem({
        taskId: "task-1",
        projectName: "coordinator",
        title: "冻结需求",
        actionIds: ["freeze-requirements"]
      })
    ).toMatchObject({
      id: "workflow-gate-task-1-freeze-requirements",
      kind: "workflow",
      tone: "waiting",
      label: "Requirements approval",
      summary: "freeze-requirements"
    });
    expect(
      buildWorkflowGateInboxItem({
        taskId: "task-2",
        projectName: "coordinator",
        title: "实现变更",
        actionIds: ["materialize-change"]
      })
    ).toBeUndefined();
  });

  it("workflow gate evidence ready 才允许提交", () => {
    expect(
      workflowGateEvidenceCanSubmit(
        {
          workflowRunId: "run-1",
          taskId: "task-1",
          attemptId: "attempt-1",
          workflowRunStateVersion: 1,
          evidenceStatus: "ready",
          canSubmit: true,
          primaryAction: "freeze-requirements",
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
          warnings: []
        },
        "freeze-requirements"
      )
    ).toBe(true);

    expect(
      workflowGateEvidenceCanSubmit(
        {
          workflowRunId: "run-1",
          taskId: "task-1",
          attemptId: "attempt-1",
          workflowRunStateVersion: 1,
          evidenceStatus: "missing",
          canSubmit: false,
          primaryAction: "freeze-requirements",
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
        "freeze-requirements"
      )
    ).toBe(false);
    expect(workflowGateEvidenceStatusLabel(undefined)).toBe("Loading gate evidence");
  });

  it("gate evidence refresh key 会随 inner session 状态和 final response 变化", () => {
    const baseDetail = {
      agentSessions: [
        {
          id: "outer-1",
          role: "outer",
          providerKind: "codex",
          status: "running"
        },
        {
          id: "inner-1",
          role: "inner",
          providerKind: "codex",
          status: "running",
          activity: { eventCount: 1, state: "running", artifactRefs: {}, lastActivityAt: "2026-05-26T10:00:00Z" }
        }
      ]
    };
    const completedDetail = {
      ...baseDetail,
      agentSessions: [
        baseDetail.agentSessions[0],
        {
          ...baseDetail.agentSessions[1],
          status: "completed",
          finalResponsePath: "/tmp/final-response.md",
          activity: { eventCount: 2, state: "completed", artifactRefs: {}, lastActivityAt: "2026-05-26T10:01:00Z" }
        }
      ]
    };

    expect(buildWorkflowGateEvidenceRefreshKey(baseDetail as never)).not.toBe(
      buildWorkflowGateEvidenceRefreshKey(completedDetail as never)
    );
  });
});
