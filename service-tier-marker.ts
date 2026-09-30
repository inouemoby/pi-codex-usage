export interface FastTierStatus {
  provider: string;
  modelId: string;
  fast: boolean;
}

export function hasActiveFastTierMarker(
  model: { provider?: string; id?: string } | undefined,
  status: FastTierStatus | undefined,
): boolean {
  return Boolean(
    model &&
      status?.fast === true &&
      status.provider === model.provider &&
      status.modelId === model.id,
  );
}

export function getReturnedFastTier(data: unknown): boolean | undefined {
  if (!isRecord(data) || typeof data.type !== "string") return undefined;

  if (data.type === "error" || data.type === "response.failed") return false;
  if (
    data.type !== "response.completed" &&
    data.type !== "response.done" &&
    data.type !== "response.incomplete"
  ) {
    return undefined;
  }

  const response = isRecord(data.response) ? data.response : undefined;
  return response?.service_tier === "priority" || response?.service_tier === "fast";
}

export function getFastTierMarker(
  model: { provider?: string; id?: string } | undefined,
  status: FastTierStatus | undefined,
  responseStatus: FastTierStatus | undefined,
): string {
  if (!model || !hasActiveFastTierMarker(model, status)) return "";

  return responseStatus !== undefined &&
    responseStatus.provider === model.provider &&
    responseStatus.modelId === model.id &&
    !responseStatus.fast
    ? "!⚡"
    : "⚡";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
