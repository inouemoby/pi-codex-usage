import assert from "node:assert/strict";
import test from "node:test";

import {
  getFastTierMarker,
  getReturnedFastTier,
  hasActiveFastTierMarker,
} from "./service-tier-marker.ts";

const model = { provider: "openai-codex", id: "gpt-6.1-sol" };
const fastStatus = {
  provider: "openai-codex",
  modelId: "gpt-6.1-sol",
  fast: true,
};

test("marks the exact active fast-tier model", () => {
  assert.equal(hasActiveFastTierMarker(model, fastStatus), true);
});

test("parses the returned tier from final provider stream events", () => {
  assert.equal(
    getReturnedFastTier({
      type: "response.completed",
      response: { service_tier: "priority" },
    }),
    true,
  );
  assert.equal(
    getReturnedFastTier({
      type: "response.done",
      response: { service_tier: "fast" },
    }),
    true,
  );
  assert.equal(
    getReturnedFastTier({
      type: "response.completed",
      response: { service_tier: "default" },
    }),
    false,
  );
  assert.equal(
    getReturnedFastTier({ type: "response.completed", response: {} }),
    false,
  );
  assert.equal(getReturnedFastTier({ type: "response.failed" }), false);
  assert.equal(
    getReturnedFastTier({ type: "response.output_text.delta" }),
    undefined,
  );
});

test("shows ! only when the returned tier for this model is not fast", () => {
  assert.equal(getFastTierMarker(model, fastStatus, undefined), "⚡");
  assert.equal(
    getFastTierMarker(model, fastStatus, { ...fastStatus, fast: true }),
    "⚡",
  );
  assert.equal(
    getFastTierMarker(model, fastStatus, { ...fastStatus, fast: false }),
    "!⚡",
  );
  assert.equal(
    getFastTierMarker(model, fastStatus, {
      ...fastStatus,
      provider: "openai",
      fast: false,
    }),
    "⚡",
  );
});

test("does not mark inactive or different models/providers", () => {
  assert.equal(
    hasActiveFastTierMarker(model, { ...fastStatus, fast: false }),
    false,
  );
  assert.equal(
    hasActiveFastTierMarker(model, { ...fastStatus, provider: "openai" }),
    false,
  );
  assert.equal(
    hasActiveFastTierMarker(model, { ...fastStatus, modelId: "gpt-6-sol" }),
    false,
  );
});
