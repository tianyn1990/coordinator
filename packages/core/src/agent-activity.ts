import { existsSync, readFileSync } from "node:fs";

export type NormalizedAgentEventKind =
  | "session_started"
  | "turn_started"
  | "message_delta"
  | "tool_started"
  | "tool_finished"
  | "permission_requested"
  | "turn_completed"
  | "session_completed"
  | "session_failed"
  | "provider_event";

export type NormalizedAgentEvent = {
  kind: NormalizedAgentEventKind;
  summary: string;
  timestamp?: string;
  severity: "debug" | "info" | "warn" | "error";
  providerId?: string;
  metadata?: {
    providerEventType?: string;
  };
};

export type AgentActivityState = "starting" | "running" | "completed" | "failed" | "stalled" | "unknown";

export type AgentProviderEventArtifactRefs = {
  transcriptPath?: string;
  rawEventArtifactPath?: string;
  finalResponsePath?: string;
};

export type AgentActivitySummary = {
  state: AgentActivityState;
  providerId?: string;
  providerSessionId?: string;
  providerVersion?: string;
  implementationMode?: string;
  permissionProfile?: string;
  lastActivityAt?: string;
  latestEvent?: NormalizedAgentEvent;
  eventCount: number;
  failureKind?: string;
  artifactRefs: AgentProviderEventArtifactRefs;
};

export type BuildAgentActivitySummaryInput = {
  state: AgentActivityState;
  providerId?: string;
  providerSessionId?: string;
  providerVersion?: string;
  implementationMode?: string;
  permissionProfile?: string;
  transcriptPath?: string;
  rawEventArtifactPath?: string;
  finalResponsePath?: string;
  failureKind?: string;
  fallbackTimestamp?: string;
  normalizedEvents?: NormalizedAgentEvent[];
};

export function buildAgentActivitySummary(input: BuildAgentActivitySummaryInput): AgentActivitySummary {
  const events = input.normalizedEvents ?? collectNormalizedAgentEventsFromPaths(input.rawEventArtifactPath, input.transcriptPath);
  const latestEvent = events.at(-1);
  return {
    state: input.state,
    providerId: input.providerId,
    providerSessionId: input.providerSessionId,
    providerVersion: input.providerVersion,
    implementationMode: input.implementationMode,
    permissionProfile: input.permissionProfile,
    lastActivityAt: latestEvent?.timestamp ?? input.fallbackTimestamp,
    latestEvent,
    eventCount: events.length,
    failureKind: input.failureKind,
    artifactRefs: {
      transcriptPath: input.transcriptPath,
      rawEventArtifactPath: input.rawEventArtifactPath ?? input.transcriptPath,
      finalResponsePath: input.finalResponsePath
    }
  };
}

function collectNormalizedAgentEventsFromPaths(...paths: Array<string | undefined>): NormalizedAgentEvent[] {
  const normalized: NormalizedAgentEvent[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    // 独立 provider-events artifact 优先；transcript 作为兼容 fallback，二者都只产生白名单摘要。
    normalized.push(...collectNormalizedAgentEvents(path));
  }
  return normalized;
}

export function collectNormalizedAgentEvents(transcriptPath: string | undefined, limit = 200): NormalizedAgentEvent[] {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return [];
  }
  const lines = readFileSync(transcriptPath, "utf8").split(/\r?\n/).filter(Boolean);
  const normalized: NormalizedAgentEvent[] = [];
  for (const line of lines.slice(-limit)) {
    const event = normalizeProviderEventLine(line);
    if (event) {
      normalized.push(event);
    }
  }
  return normalized;
}

export function normalizeProviderEventLine(line: string): NormalizedAgentEvent | undefined {
  try {
    return normalizeProviderEvent(JSON.parse(line));
  } catch {
    return {
      kind: "provider_event",
      summary: "provider transcript line was not structured JSON",
      severity: "debug"
    };
  }
}

export function normalizeProviderEvent(value: unknown): NormalizedAgentEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const wrapperType = readString(value.type);
  const providerId = readString(value.providerId) ?? readString(value.provider);
  const rawEvent = value.event;
  const rawRecord = isRecord(rawEvent) ? rawEvent : undefined;
  const rawType = normalizeEventType(
    readString(rawRecord?.type) ??
      readString(rawRecord?.subtype) ??
      (typeof rawEvent === "string" ? rawEvent : undefined) ??
      wrapperType
  );
  const timestamp = readString(value.createdAt) ?? readString(rawRecord?.createdAt) ?? readString(rawRecord?.timestamp);

  if (!rawType) {
    return {
      kind: "provider_event",
      summary: providerId ? `${providerId} provider event captured` : "provider event captured",
      timestamp,
      severity: "debug",
      providerId
    };
  }

  const kind = mapProviderEventKind(rawType, rawRecord);
  const severity = kind === "session_failed" ? "error" : kind === "permission_requested" ? "warn" : "debug";
  return {
    kind,
    summary: summarizeNormalizedEvent(kind, providerId, rawType),
    timestamp,
    severity,
    providerId,
    metadata: {
      providerEventType: rawType
    }
  };
}

export function extractAgentActivitySummary(value: unknown): AgentActivitySummary | undefined {
  const record = isRecord(value) ? value : undefined;
  const candidate = isRecord(record?.agentActivity) ? record.agentActivity : record;
  if (!isRecord(candidate)) {
    return undefined;
  }
  const state = readString(candidate.state);
  if (!isAgentActivityState(state)) {
    return undefined;
  }
  const latestEvent = sanitizeNormalizedAgentEvent(candidate.latestEvent);
  const artifactRefs = isRecord(candidate.artifactRefs) ? candidate.artifactRefs : {};
  return {
    state,
    providerId: readString(candidate.providerId),
    providerSessionId: readString(candidate.providerSessionId),
    providerVersion: readString(candidate.providerVersion),
    implementationMode: readString(candidate.implementationMode),
    permissionProfile: readString(candidate.permissionProfile),
    lastActivityAt: readString(candidate.lastActivityAt),
    latestEvent,
    eventCount: readNumber(candidate.eventCount) ?? 0,
    failureKind: readString(candidate.failureKind),
    artifactRefs: {
      transcriptPath: readString(artifactRefs.transcriptPath),
      rawEventArtifactPath: readString(artifactRefs.rawEventArtifactPath),
      finalResponsePath: readString(artifactRefs.finalResponsePath)
    }
  };
}

function mapProviderEventKind(rawType: string, rawRecord: Record<string, unknown> | undefined): NormalizedAgentEventKind {
  const lowered = rawType.toLowerCase();
  if (lowered.includes("permission")) {
    return "permission_requested";
  }
  if (lowered.includes("failed") || lowered === "error" || lowered.includes("error")) {
    return "session_failed";
  }
  if (lowered.includes("thread.started") || (lowered === "system" && readString(rawRecord?.subtype) === "init")) {
    return "session_started";
  }
  if (lowered.includes("turn.started")) {
    return "turn_started";
  }
  if (lowered.includes("turn.completed") || lowered === "result") {
    return "turn_completed";
  }
  if (lowered.includes("tool") && (lowered.includes("finished") || lowered.includes("completed") || lowered.includes("result"))) {
    return "tool_finished";
  }
  if (lowered.includes("tool")) {
    return "tool_started";
  }
  const item = isRecord(rawRecord?.item) ? rawRecord.item : undefined;
  if (lowered.includes("message") || readString(item?.type) === "agent_message" || lowered === "assistant") {
    return "message_delta";
  }
  if (lowered === "agent.final_response") {
    return "session_completed";
  }
  return "provider_event";
}

function summarizeNormalizedEvent(kind: NormalizedAgentEventKind, providerId: string | undefined, rawType: string): string {
  const provider = providerId ?? "provider";
  switch (kind) {
    case "session_started":
      return `${provider} session started`;
    case "turn_started":
      return `${provider} turn started`;
    case "message_delta":
      return `${provider} message activity`;
    case "tool_started":
      return `${provider} tool activity started`;
    case "tool_finished":
      return `${provider} tool activity finished`;
    case "permission_requested":
      return `${provider} requested permission`;
    case "turn_completed":
      return `${provider} turn completed`;
    case "session_completed":
      return `${provider} final response captured`;
    case "session_failed":
      return `${provider} reported failure`;
    case "provider_event":
      return `${provider} event captured: ${rawType}`;
  }
}

function sanitizeNormalizedAgentEvent(value: unknown): NormalizedAgentEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const kind = readString(value.kind);
  if (!isNormalizedAgentEventKind(kind)) {
    return undefined;
  }
  const severity = readString(value.severity);
  return {
    kind,
    summary: truncate(readString(value.summary) ?? kind, 240),
    timestamp: readString(value.timestamp),
    severity: isSeverity(severity) ? severity : "debug",
    providerId: readString(value.providerId),
    metadata: isRecord(value.metadata)
      ? {
          providerEventType: truncate(readString(value.metadata.providerEventType) ?? "", 120) || undefined
        }
      : undefined
  };
}

function isNormalizedAgentEventKind(value: string | undefined): value is NormalizedAgentEventKind {
  return (
    value === "session_started" ||
    value === "turn_started" ||
    value === "message_delta" ||
    value === "tool_started" ||
    value === "tool_finished" ||
    value === "permission_requested" ||
    value === "turn_completed" ||
    value === "session_completed" ||
    value === "session_failed" ||
    value === "provider_event"
  );
}

function isAgentActivityState(value: string | undefined): value is AgentActivityState {
  return value === "starting" || value === "running" || value === "completed" || value === "failed" || value === "stalled" || value === "unknown";
}

function isSeverity(value: string | undefined): value is NormalizedAgentEvent["severity"] {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function normalizeEventType(value: string | undefined): string | undefined {
  return value ? truncate(value.trim(), 120) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...[truncated]` : value;
}
