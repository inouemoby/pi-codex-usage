export interface FastTierStatus {
  provider: string;
  modelId: string;
  fast: boolean;
}

export interface FastTierRequestStatus extends FastTierStatus {
  applied: boolean;
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

export function getFastTierMarker(
  model: { provider?: string; id?: string } | undefined,
  status: FastTierStatus | undefined,
  requestStatus: FastTierRequestStatus | undefined,
): string {
  if (!model || !hasActiveFastTierMarker(model, status)) return "";

  const requestFailedForModel =
    requestStatus !== undefined &&
    requestStatus.provider === model.provider &&
    requestStatus.modelId === model.id &&
    requestStatus.fast &&
    !requestStatus.applied;
  return requestFailedForModel ? "!⚡" : "⚡";
}
