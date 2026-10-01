import assert from "node:assert/strict";
import test from "node:test";

import {
  completeOutputTiming,
  createOutputMetricsTicker,
  createOutputTiming,
  estimateStreamingOutputTokens,
  formatRecentOutput,
  liveOutputTiming,
  observeOutputEvent,
} from "./output-metrics.ts";

const emptyMessage: any = { content: [] };

test("captures the first hidden reasoning delta before visible text", () => {
  const timing = createOutputTiming(100);
  const thinking: any = { type: "thinking_delta", contentIndex: 0, delta: "hidden", partial: {} };
  const text: any = { type: "text_delta", contentIndex: 1, delta: "answer", partial: {} };
  assert.equal(observeOutputEvent(timing, thinking, emptyMessage, 450), true);
  assert.equal(observeOutputEvent(timing, text, emptyMessage, 800), false);
  assert.equal(timing.firstTokenAt, 450);
  assert.equal(formatRecentOutput(liveOutputTiming(timing, 450)), "0.35s");
});

test("uses complete redacted thinking at block start and visible text as fallback", () => {
  const redactedTiming = createOutputTiming(0);
  const message: any = { content: [{ type: "thinking", thinking: "opaque", redacted: true }] };
  const thinkingStart: any = { type: "thinking_start", contentIndex: 0, partial: message };
  assert.equal(observeOutputEvent(redactedTiming, thinkingStart, message, 125), true);

  const visibleTiming = createOutputTiming(0);
  const textEnd: any = { type: "text_end", contentIndex: 0, content: "Hello", partial: {} };
  assert.equal(observeOutputEvent(visibleTiming, textEnd, emptyMessage, 300), true);
});

test("does not mistake a late reasoning summary for TTFT or double-count end events", () => {
  const timing = createOutputTiming(0);
  const lateThinking: any = { type: "thinking_end", contentIndex: 0, content: "late summary", partial: {} };
  const thinkingDelta: any = { type: "thinking_delta", contentIndex: 1, delta: "start", partial: {} };
  const thinkingEnd: any = { type: "thinking_end", contentIndex: 1, content: "start", partial: {} };
  assert.equal(observeOutputEvent(timing, lateThinking, emptyMessage, 200), false);
  assert.equal(observeOutputEvent(timing, thinkingDelta, emptyMessage, 400), true);
  const beforeEnd = estimateStreamingOutputTokens(timing);
  assert.equal(observeOutputEvent(timing, thinkingEnd, emptyMessage, 500), false);
  assert.equal(estimateStreamingOutputTokens(timing), beforeEnd);
});

test("estimates live t/s and finalizes with provider-reported output usage", () => {
  const timing = createOutputTiming(100);
  const text: any = { type: "text_delta", contentIndex: 0, delta: "This is a streaming response.", partial: {} };
  assert.equal(observeOutputEvent(timing, text, emptyMessage, 500), true);
  const live = liveOutputTiming(timing, 1500);
  assert.equal(live.ttftMs, 400);
  assert.equal(live.estimated, true);
  assert.match(formatRecentOutput(live), /^0\.40s ~[\d.]+t\/s$/);

  const final = completeOutputTiming(timing, 1500, 200);
  assert.deepEqual(final, { ttftMs: 400, tokensPerSecond: 200 });
  assert.equal(formatRecentOutput(final!), "0.40s 200t/s");
});

test("counts tool wait toward the next TTFT but not the previous output rate", () => {
  const toolStartedAt = 100;
  const nextRequestAt = 900;
  const firstNextTokenAt = 1100;
  const timing = createOutputTiming(toolStartedAt);
  const delta: any = { type: "text_delta", contentIndex: 0, delta: "next response", partial: {} };
  observeOutputEvent(timing, delta, emptyMessage, firstNextTokenAt);

  const metrics = completeOutputTiming(timing, 2100, 100);
  const toolWaitMs = nextRequestAt - toolStartedAt;
  const nextRequestLatencyMs = firstNextTokenAt - nextRequestAt;
  assert.equal(metrics?.ttftMs, toolWaitMs + nextRequestLatencyMs);
  assert.equal(metrics?.tokensPerSecond, 100); // only first token → response end
});

test("falls back to an estimated final rate only when provider usage is absent", () => {
  const timing = createOutputTiming(0);
  const delta: any = { type: "text_delta", contentIndex: 0, delta: "Hello", partial: {} };
  observeOutputEvent(timing, delta, emptyMessage, 250);
  const final = completeOutputTiming(timing, 1250);
  assert.equal(final?.estimated, true);
  assert.match(formatRecentOutput(final!), /^0\.25s ~[\d.]+t\/s$/);
  assert.equal(completeOutputTiming(createOutputTiming(0), 100, 10), null);
});

test("uses compact CJK-friendly live token estimates", () => {
  const timing = createOutputTiming(0);
  const cjk: any = { type: "text_delta", contentIndex: 0, delta: "你好世界", partial: {} };
  observeOutputEvent(timing, cjk, emptyMessage, 100);
  assert.equal(estimateStreamingOutputTokens(timing), 4);
});

test("refreshes at one-second intervals and stops cleanly", () => {
  let scheduledCallback: (() => void) | undefined;
  let scheduleCount = 0;
  let cancelCount = 0;
  const ticker = createOutputMetricsTicker(
    ((callback: () => void, delay: number) => {
      assert.equal(delay, 1000);
      scheduledCallback = callback;
      scheduleCount++;
      return {} as ReturnType<typeof setInterval>;
    }) as typeof setInterval,
    (() => { cancelCount++; }) as typeof clearInterval,
  );

  let ticks = 0;
  const refresh = () => { ticks++; };
  ticker.start(refresh);
  ticker.start(refresh);
  assert.equal(scheduleCount, 1);
  scheduledCallback?.();
  assert.equal(ticks, 1);
  ticker.stop();
  ticker.stop();
  assert.equal(cancelCount, 1);
  ticker.start(refresh);
  assert.equal(scheduleCount, 2);
  ticker.stop();
  assert.equal(cancelCount, 2);
});
