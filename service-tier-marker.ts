export interface FastTierStatus {
  provider: string;
  modelId: string;
  fast: boolean;
}

const SERVICE_TIER_WIDGET_ID = "pi-service-tier.service-tier";

export function getServiceTierWidgetState(payload: unknown): boolean | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const event = payload as Record<string, unknown>;
  if (event.type === "remove" && event.id === SERVICE_TIER_WIDGET_ID) return false;
  if (event.type !== "upsert") return undefined;

  const widget = event.widget;
  if (!widget || typeof widget !== "object") return undefined;
  const record = widget as Record<string, unknown>;
  if (record.id !== SERVICE_TIER_WIDGET_ID) return undefined;

  const content = record.content;
  if (!content || typeof content !== "object") return undefined;
  const contentRecord = content as Record<string, unknown>;
  if (contentRecord.type !== "text") return undefined;
  const text = contentRecord.text;
  if (typeof text !== "string") return undefined;
  return text.length > 0;
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
): string {
  return hasActiveFastTierMarker(model, status) ? "⚡" : "";
}
