import { describe, expect, it } from "vitest";
import { buildWorkflowGateInboxItem, groupWorkflowActions, summarizeWorkflowGate, workflowActionButtonLabel } from "./workflow-actions.js";

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
});
