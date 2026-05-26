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
    attachments: [],
    taskNotes: [],
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

  it("human_waiting surface 没有 workflow run 时不暴露工具", () => {
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

    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual([]);
    expect(surface.json.denied_actions).toContain("不要在 human request 等待中继续执行副作用操作。");
  });

  it("human_waiting surface 有 workflow run 时只暴露 inspect 类工具", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "human_waiting",
        currentState: { taskStatus: "waiting_human", humanRequestStatus: "pending" },
        workflowRuns: [{ id: "run-1", status: "running", profileId: "feature" }],
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
  });

  it("workflow running surface 明确 inspect 或等待 handoff，不暴露 workflow action", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "execution",
        task: { ...baseSnapshot().task, status: "running" },
        executionPlan: { id: "plan-1", status: "active", artifactPath: "execution-plan.md" },
        attempt: { id: "attempt-1", status: "created" },
        workspace: { id: "workspace-1", status: "ready", path: "/tmp/workspace", branch: "coordinator/task/attempt" },
        workflowRuns: [
          {
            id: "workflow-1",
            status: "running",
            profileId: "feature",
            observation: {
              mode: "observing-runtime",
              owner: "workflow-runtime",
              handoffAvailable: false
            }
          }
        ]
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual(["inspect_workflow_run", "ask_human"]);
    expect(surface.json.available_tools.map((tool) => tool.name)).not.toContain("start_workflow_run");
    expect(JSON.stringify(surface.json.available_tools)).not.toContain("workflow_action");
    expect(surface.markdown).toContain("等待 workflow 自己推进");
    expect(surface.markdown).toContain("不要绕过 workflow handoff 执行内部 action");
    expect(surface.markdown).toContain("runtime_observation: mode=observing-runtime owner=workflow-runtime");
    expect(JSON.stringify(surface.json)).not.toContain("change-id");
  });

  it("surface 不暴露 operator-only 工具", () => {
    const surface = buildCoordinatorSurface(baseSnapshot());

    expect(surface.json.available_tools.map((tool) => tool.name)).not.toContain("record_human_answer");
  });

  it("paused 和 canceled task 的 surface 只保留 inspect 语义，不暴露执行工具", () => {
    const paused = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "resume",
        task: { ...baseSnapshot().task, status: "paused" },
        workflowRuns: [{ id: "run-paused", status: "running", profileId: "feature" }]
      })
    );
    const canceled = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "completed",
        task: { ...baseSnapshot().task, status: "canceled" },
        workflowRuns: [{ id: "run-canceled", status: "completed", profileId: "feature" }]
      })
    );

    expect(paused.json.available_tools.map((tool) => tool.name)).toEqual(["inspect_workflow_run"]);
    expect(paused.json.denied_actions).toContain("任务已被 operator pause；不要继续执行副作用操作，等待 operator resume。");
    expect(paused.json.recommended_next_step).toContain("operator resume");
    expect(canceled.json.available_tools.map((tool) => tool.name)).toEqual(["inspect_workflow_run"]);
    expect(canceled.json.denied_actions).toContain("任务已被 operator cancel；不要继续推进 task、workspace、workflow 或 PR/MR。");
    expect(canceled.json.recommended_next_step).toContain("已取消");
  });

  it("PR/MR open surface 暴露 review/update 相关工具", () => {
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

  it("PR/MR review approved surface 暴露 request_merge_approval", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "review",
        pullRequest: {
          id: "pr-1",
          providerKind: "github",
          status: "open",
          headBranch: "feature",
          baseBranch: "main",
          reviewStatus: "approved"
        }
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual([
      "inspect_review",
      "update_pr",
      "request_merge_approval",
      "ask_human"
    ]);
  });

  it("merge_waiting surface 未审批时暴露 request approval 而不暴露 merge", () => {
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
      "inspect_review",
      "ask_human"
    ]);
    expect(surface.json.available_tools.map((tool) => tool.name)).not.toContain("merge_after_approval");
  });

  it("merge_waiting surface 在 approval snapshot 有效时暴露 merge_after_approval", () => {
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
          baseSha: "base-1",
          reviewStatus: "clean",
          validationRunId: "validation-1"
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

    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual(["merge_after_approval", "inspect_review"]);
  });

  it("merge_waiting surface 即使 approval 匹配但 review 未 clean 也不暴露 merge", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "merge_waiting",
        pullRequest: {
          id: "pr-1",
          providerKind: "github",
          status: "open",
          headSha: "head-1",
          baseSha: "base-1",
          reviewStatus: "changes_requested",
          validationRunId: "validation-1"
        },
        mergeApproval: {
          prId: "pr-1",
          status: "approved",
          valid: true,
          headSha: "head-1",
          baseSha: "base-1",
          validationRunId: "validation-1",
          mergeStrategy: "squash"
        }
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).not.toContain("merge_after_approval");
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

  it("completed_no_pr surface 缺少当前 executor 能力时只暴露 ask_human", () => {
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

  it("blocked workspace 即使 workflow handoff pr_ready 也不暴露 create_pr", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "execution",
        executionPlan: { id: "plan-1", status: "active", artifactPath: "execution-plan.md" },
        attempt: { id: "attempt-1", status: "running" },
        workspace: { id: "workspace-1", status: "blocked" },
        workflowRuns: [
          {
            id: "run-1",
            status: "handoff",
            handoffKind: "pr_ready"
          }
        ]
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).not.toContain("create_pr");
    expect(surface.json.available_tools.map((tool) => tool.name)).not.toContain("start_workflow_run");
    expect(surface.json.denied_actions).toContain("workspace recovery 已进入 operator review；不要启动 workflow 或继续执行 workspace 副作用。");
  });

  it("PR/MR recovery 不新增 agent-facing recovery tool，也不暴露 provider raw output", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "review",
        pullRequest: {
          id: "pr-1",
          providerKind: "github",
          status: "open",
          headBranch: "feature",
          baseBranch: "main",
          reviewSummary: "provider raw output should stay out"
        }
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(["recover_pr", "reconcile_merge", "force_merge"])
    );
    expect(surface.markdown).not.toContain("provider raw output");
  });


  it("completed_no_pr surface 即使 no-PR policy 有效也不提前暴露 mark_done", () => {
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

    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual(["ask_human"]);
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

  it("workflow running surface 不暴露尚未实现的 resume_workflow_run", () => {
    const surface = buildCoordinatorSurface(
      baseSnapshot({
        surfaceKind: "execution",
        executionPlan: { id: "plan-1", status: "active", artifactPath: "execution-plan.md" },
        attempt: { id: "attempt-1", status: "running" },
        workspace: { id: "workspace-1", status: "ready" },
        workflowRuns: [{ id: "run-1", status: "running", profileId: "feature" }]
      })
    );

    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual(["inspect_workflow_run", "ask_human"]);
  });
});
