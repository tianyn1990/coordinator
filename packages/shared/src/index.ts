export const serviceInfo = {
  name: "coordinator",
  stage: "iteration-1-project-skeleton"
} as const;

export type HealthStatus = {
  ok: true;
  service: typeof serviceInfo.name;
  stage: typeof serviceInfo.stage;
};

export function getHealthStatus(): HealthStatus {
  return {
    ok: true,
    service: serviceInfo.name,
    stage: serviceInfo.stage
  };
}
