export type QuotaDisplayMode = "used" | "remaining";

export function resolveQuotaDisplayMode(config: unknown): QuotaDisplayMode {
  if (typeof config !== "object" || config === null) return "used";
  const mode = (config as { quotaDisplay?: unknown }).quotaDisplay;
  return mode === "remaining" ? "remaining" : "used";
}

export function displayQuotaPercent(
  usedPercent: number,
  mode: QuotaDisplayMode,
): number {
  if (mode === "used") return usedPercent;
  return Math.max(0, Math.min(100, 100 - usedPercent));
}
