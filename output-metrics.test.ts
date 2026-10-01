import assert from "node:assert/strict";
import test from "node:test";

import {
  completeOutputTiming,
  createOutputTiming,
  firstTokenMetrics,
  formatRecentOutput,
  observeOutputEvent,
  retainPreviousTokenRate,
} from "./output-metrics.ts";

const emptyMessage: any = { content: [] };

test("captures hidden reasoning first and exposes TTFT without dropping the prior TPS", () => {
  const timing = createOutputTiming(100);
  const thinking: any = { type: "thinking_delta", contentIndex: 0, delta: "hidden", partial: {} };
  const text: any = { type: "text_delta", contentIndex: 1, delta: "answer", partial: {} };
  assert.equal(observeOutputEvent(timing, thinking, emptyMessage, 450), true);

  const immediate = retainPreviousTokenRate(firstTokenMetrics(timing)!, {
    ttftMs: 700,
    tokensPerSecond: 52,
  });
  assert.deepEqual(immediate, { ttftMs: 350, tokensPerSecond: 52 });
  assert.equal(formatRecentOutput(immediate), "0.35s 52t/s");
  assert.equal(observeOutputEvent(timing, text, emptyMessage, 800), false);
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
  assert.equal(timing.lastOutputAt, 200);
  assert.equal(observeOutputEvent(timing, thinkingDelta, emptyMessage, 400), true);
  assert.equal(observeOutputEvent(timing, thinkingEnd, emptyMessage, 500), false);
  assert.equal(timing.lastOutputAt, 400);
});

test("uses actual output tokens over first-to-last stream time, excluding TTFT and finalization", () => {
  const timing = createOutputTiming(100);
  const first: any = { type: "text_delta", contentIndex: 0, delta: "Response", partial: {} };
  const last: any = { type: "text_delta", contentIndex: 0, delta: " continues", partial: {} };
  assert.equal(observeOutputEvent(timing, first, emptyMessage, 500), true);
  observeOutputEvent(timing, last, emptyMessage, 1000);

  const final = completeOutputTiming(timing, 200);
  assert.deepEqual(final, { ttftMs: 400, tokensPerSecond: 400 });
  assert.equal(formatRecentOutput(final!), "0.40s 400t/s");
});

test("assigns tool/server wait to next TTFT, not the previous request TPS", () => {
  const toolStartedAt = 100;
  const nextRequestAt = 900;
  const firstNextTokenAt = 1100;
  const timing = createOutputTiming(toolStartedAt);
  const first: any = { type: "text_delta", contentIndex: 0, delta: "next response", partial: {} };
  const last: any = { type: "text_delta", contentIndex: 0, delta: " continues", partial: {} };
  observeOutputEvent(timing, first, emptyMessage, firstNextTokenAt);
  observeOutputEvent(timing, last, emptyMessage, 2100);

  const metrics = completeOutputTiming(timing, 100);
  const toolWaitMs = nextRequestAt - toolStartedAt;
  const nextRequestLatencyMs = firstNextTokenAt - nextRequestAt;
  assert.equal(metrics?.ttftMs, toolWaitMs + nextRequestLatencyMs);
  assert.equal(metrics?.tokensPerSecond, 100);
});

test("does not invent TPS when exact token usage is unavailable", () => {
  const timing = createOutputTiming(0);
  const first: any = { type: "text_delta", contentIndex: 0, delta: "partial output", partial: {} };
  const last: any = { type: "text_delta", contentIndex: 0, delta: " more", partial: {} };
  observeOutputEvent(timing, first, emptyMessage, 250);
  observeOutputEvent(timing, last, emptyMessage, 750);

  const incomplete = completeOutputTiming(timing, undefined);
  assert.deepEqual(incomplete, { ttftMs: 250, tokensPerSecond: undefined });
  assert.equal(formatRecentOutput(incomplete!), "0.25s");
  assert.deepEqual(
    retainPreviousTokenRate(incomplete!, { ttftMs: 900, tokensPerSecond: 61 }),
    { ttftMs: 250, tokensPerSecond: 61 },
  );
  assert.equal(completeOutputTiming(createOutputTiming(0), 10), null);
});

test("uses partial actual usage for interrupted responses when provided", () => {
  const timing = createOutputTiming(0);
  const first: any = { type: "text_delta", contentIndex: 0, delta: "partial", partial: {} };
  const last: any = { type: "text_delta", contentIndex: 0, delta: " output", partial: {} };
  observeOutputEvent(timing, first, emptyMessage, 100);
  observeOutputEvent(timing, last, emptyMessage, 600);
  assert.deepEqual(completeOutputTiming(timing, 25), { ttftMs: 100, tokensPerSecond: 50 });
});
