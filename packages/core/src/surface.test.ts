import { describe, expect, it } from "vitest";
import { buildCoordinatorSurface, type SurfaceKind, type SurfaceSnapshot } from "./surface.js";

function baseSnapshot(overrides: Partial<SurfaceSnapshot> = {}): SurfaceSnapshot {
  return {
    surfaceKind: "bootstrap",
    task: {
      id: "task-1",
      title: "task",
      description: "desc",
      autonomy: "balanced",
      sourceKind: "manual",
      status: "created",
      stateVersion: 0
    },
    project: {
      id: "project-1",
      name: "coordinator"
    },
    currentState: {
      taskStatus: "created"
    },
    workflowRuns: [],
    agentSessions: [],
    humanRequests: [],
    artifactRoot: "coordinator/artifacts/",
    createdAt: "2026-05-03T00:00:00.000Z",
    autonomyGuidance: { level: "balanced" },
    memoryTrustBoundary: {
      attemptLocal: "attempt local",
      projectLocal: "project local",
      crossProject: "cross project"
    },
    validationContract: {
      status: "not_ready",
      latestValidation: "not ready"
    },
    ...overrides
  };
}

describe("Coordinator Surface", () => {
  it("fixtures 覆盖第一版全部 surface kind", () => {
    const kinds: SurfaceKind[] = [
      "bootstrap",
      "planning",
      "execution",
      "human_waiting",
      "human_answered",
      "review",
      "merge_waiting",
      "completed",
      "failure",
      "resume"
    ];

    for (const kind of kinds) {
      const surface = buildCoordinatorSurface(baseSnapshot({ surfaceKind: kind }));

      expect(surface.json.surface_kind).toBe(kind);
      expect(surface.markdown).toContain("# Coordinator Surface");
    }
  });

  it("bootstrap surface 包含必需字段并输出 Markdown", () => {
    const surface = buildCoordinatorSurface(baseSnapshot());

    expect(surface.surfaceKind).toBe("bootstrap");
    expect(surface.json.surface_kind).toBe("bootstrap");
    expect(surface.json.surface_id).toBe(surface.surfaceId);
    expect(surface.json.artifact_root).toBe("coordinator/artifacts/");
    expect(surface.markdown).toContain("当前自主级别：balanced。");
    expect(surface.markdown).toContain("artifact_root");
  });

  it("human_waiting surface 只暴露 inspect 类工具", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "human_waiting",
        currentState: { taskStatus: "waiting_human", humanRequestStatus: "pending" },
        humanRequests: [
          {
            id: "human-1",
            kind: "requirements-clarification",
            status: "pending",
            blockedKey: "gate:clarify"
          }
        ]
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual(["inspect_workflow_run"]);
    expect(surface.json.denied_actions).toContain("不要在 human request 等待中继续执行副作用操作。");
  });

  it("surface 不暴露 operator-only 工具", () => {
    const surface = buildCoordinatorSurface(baseSnapshot());

    expect(surface.json.available_tools.map((tool) => tool.name)).not.toContain("record_human_answer");
  });

  it("PR/MR open surface 暴露 review/update 工具，不直接请求 merge approval", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "review",
        pullRequest: {
          id: "pr-1",
          providerKind: "github",
          status: "open",
          headBranch: "feature",
          baseBranch: "main"
        }
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual(["inspect_review", "update_pr", "ask_human"]);
  });

  it("merge_waiting surface 在 approval 缺失时不暴露 merge", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "merge_waiting",
        pullRequest: {
          id: "pr-1",
          providerKind: "github",
          status: "open",
          headBranch: "feature",
          baseBranch: "main",
          headSha: "head-1",
          baseSha: "base-1"
        }
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual([
      "request_merge_approval",
      "inspect_review"
    ]);
  });

  it("merge_waiting surface 在 approval snapshot 有效时暴露 merge", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "merge_waiting",
        pullRequest: {
          id: "pr-1",
          providerKind: "github",
          status: "open",
          headBranch: "feature",
          baseBranch: "main",
          headSha: "head-1",
          baseSha: "base-1"
        },
        mergeApproval: {
          prId: "pr-1",
          status: "approved",
          valid: true,
          headSha: "head-1",
          baseSha: "base-1",
          validationRunId: "validation-1",
          mergeStrategy: "squash"
        },
        humanRequests: [
          {
            id: "approval-1",
            kind: "merge_approval",
            status: "approved",
            blockedKey: "pr:pr-1"
          }
        ]
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).toContain("merge_after_approval");
  });

  it("merge_waiting surface 在 approval snapshot 不匹配时不暴露 merge", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "merge_waiting",
        pullRequest: {
          id: "pr-1",
          providerKind: "github",
          status: "open",
          headSha: "head-current",
          baseSha: "base-current"
        },
        mergeApproval: {
          prId: "pr-1",
          status: "approved",
          valid: true,
          headSha: "head-old",
          baseSha: "base-current",
          validationRunId: "validation-1",
          mergeStrategy: "squash"
        }
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).not.toContain("merge_after_approval");
  });

  it("completed_no_pr surface 只有在 no-PR policy 和 evidence 有效时才暴露 mark_done", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "execution",
        executionPlan: { id: "plan-1", status: "ready", artifactPath: "execution-plan.md" },
        attempt: { id: "attempt-1", status: "running" },
        workspace: { id: "workspace-1", status: "ready" },
        currentState: { taskStatus: "running" },
        workflowRuns: [
          {
            id: "run-1",
            status: "completed",
            handoffKind: "completed_no_pr"
          }
        ]
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual(["ask_human"]);
  });

  it("completed_no_pr surface 在 no-PR policy 有效时可暴露 mark_done", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "execution",
        executionPlan: { id: "plan-1", status: "ready", artifactPath: "execution-plan.md" },
        attempt: { id: "attempt-1", status: "running" },
        workspace: { id: "workspace-1", status: "ready" },
        currentState: { taskStatus: "running" },
        workflowRuns: [
          {
            id: "run-1",
            status: "completed",
            handoffKind: "completed_no_pr"
          }
        ],
        noPrCompletion: {
          policyValid: true,
          evidenceArtifactPath: "verification.md"
        }
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual(["mark_done"]);
  });

  it("只有 summary state 显示 PR open 时不暴露 PR 工具", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "review",
        currentState: {
          taskStatus: "review",
          pullRequestStatus: "open"
        },
        executionPlan: { id: "plan-1", status: "ready", artifactPath: "execution-plan.md" },
        attempt: { id: "attempt-1", status: "running" },
        workspace: { id: "workspace-1", status: "ready" }
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).not.toContain("update_pr");
  });
});
