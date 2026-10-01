import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";

export interface OutputTiming {
  requestStartedAt: number;
  firstTokenAt?: number;
  asciiCharacters: number;
  otherCharacters: number;
  streamedContentIndexes: Set<number>;
  fullyRecordedContentIndexes: Set<number>;
}

export interface RecentOutputMetrics {
  ttftMs: number;
  tokensPerSecond?: number;
  estimated?: boolean;
}

export function createOutputMetricsTicker(
  schedule: typeof setInterval = setInterval,
  cancel: typeof clearInterval = clearInterval,
): { start(callback: () => void): void; stop(): void } {
  let handle: ReturnType<typeof setInterval> | null = null;
  return {
    start(callback) {
      if (handle === null) handle = schedule(callback, 1000);
    },
    stop() {
      if (handle !== null) {
        cancel(handle);
        handle = null;
      }
    },
  };
}

export function createOutputTiming(requestStartedAt: number): OutputTiming {
  return {
    requestStartedAt,
    asciiCharacters: 0,
    otherCharacters: 0,
    streamedContentIndexes: new Set(),
    fullyRecordedContentIndexes: new Set(),
  };
}

function addEstimatedText(timing: OutputTiming, text: string): void {
  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) timing.asciiCharacters++;
    else timing.otherCharacters++;
  }
}

/** Approximate live token count; final count comes from provider-reported usage. */
export function estimateStreamingOutputTokens(timing: OutputTiming): number {
  return Math.ceil(timing.asciiCharacters / 4) + timing.otherCharacters;
}

/** Observe reasoning first, then visible text/tool-call output as a fallback. */
export function observeOutputEvent(
  timing: OutputTiming,
  event: AssistantMessageEvent,
  message: AssistantMessage,
  now: number,
): boolean {
  let firstTokenIsAvailable = false;

  switch (event.type) {
    case "thinking_delta":
    case "text_delta":
    case "toolcall_delta":
      if (event.delta.length > 0) {
        addEstimatedText(timing, event.delta);
        timing.streamedContentIndexes.add(event.contentIndex);
        firstTokenIsAvailable = true;
      }
      break;
    case "text_end":
    case "thinking_end":
      if (event.content.length > 0) {
        if (
          !timing.streamedContentIndexes.has(event.contentIndex) &&
          !timing.fullyRecordedContentIndexes.has(event.contentIndex)
        ) {
          addEstimatedText(timing, event.content);
          timing.fullyRecordedContentIndexes.add(event.contentIndex);
        }
        // A late reasoning summary is not a reliable TTFT; text_end is a visible fallback.
        firstTokenIsAvailable = event.type === "text_end";
      }
      break;
    case "thinking_start": {
      // Redacted thinking can arrive complete here, without any deltas.
      const block = message.content[event.contentIndex];
      if (block?.type === "thinking" && block.thinking.length > 0) {
        addEstimatedText(timing, block.thinking);
        timing.fullyRecordedContentIndexes.add(event.contentIndex);
        firstTokenIsAvailable = true;
      }
      break;
    }
    case "toolcall_start":
      // The first function-call event is the earliest observable tool output.
      timing.otherCharacters++;
      firstTokenIsAvailable = true;
      break;
  }

  if (firstTokenIsAvailable && timing.firstTokenAt === undefined) {
    timing.firstTokenAt = now;
    return true;
  }
  return false;
}

export function completeOutputTiming(
  timing: OutputTiming,
  endedAt: number,
  outputTokens?: number,
): RecentOutputMetrics | null {
  if (timing.firstTokenAt === undefined) return null;
  const generationMs = endedAt - timing.firstTokenAt;
  if (typeof outputTokens === "number" && Number.isFinite(outputTokens) && outputTokens > 0 && generationMs > 0) {
    return {
      ttftMs: Math.max(0, timing.firstTokenAt - timing.requestStartedAt),
      tokensPerSecond: outputTokens * 1000 / generationMs,
    };
  }
  const estimatedTokens = estimateStreamingOutputTokens(timing);
  return {
    ttftMs: Math.max(0, timing.firstTokenAt - timing.requestStartedAt),
    tokensPerSecond:
      estimatedTokens > 0 && generationMs > 0 ? estimatedTokens * 1000 / generationMs : undefined,
    estimated: true,
  };
}

export function liveOutputTiming(timing: OutputTiming, now: number): RecentOutputMetrics {
  const firstTokenAt = timing.firstTokenAt ?? now;
  const generationMs = now - firstTokenAt;
  const estimatedTokens = estimateStreamingOutputTokens(timing);
  return {
    ttftMs: Math.max(0, firstTokenAt - timing.requestStartedAt),
    tokensPerSecond:
      estimatedTokens > 0 && generationMs > 0 ? estimatedTokens * 1000 / generationMs : undefined,
    estimated: true,
  };
}

export function formatSeconds(milliseconds: number): string {
  const seconds = Math.max(0, milliseconds) / 1000;
  return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)}s`;
}

export function formatRecentOutput(metrics: RecentOutputMetrics): string {
  const rate = metrics.tokensPerSecond;
  const estimateMarker = metrics.estimated ? "~" : "";
  const rateText = rate === undefined ? "" : ` ${estimateMarker}${rate < 10 ? rate.toFixed(1) : Math.round(rate)}t/s`;
  return `${formatSeconds(metrics.ttftMs)}${rateText}`;
}
