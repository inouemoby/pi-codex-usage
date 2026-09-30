import assert from "node:assert/strict";
import test from "node:test";

import {
  getFastTierMarker,
  hasActiveFastTierMarker,
} from "./service-tier-marker.ts";

const model = { provider: "openai-codex", id: "gpt-6.1-sol" };

test("marks the exact active fast-tier model", () => {
  assert.equal(
    hasActiveFastTierMarker(model, {
      provider: "openai-codex",
      modelId: "gpt-6.1-sol",
      fast: true,
    }),
    true,
  );
});

test("shows a warning when fast was active but omitted from the request payload", () => {
  const status = {
    provider: "openai-codex",
    modelId: "gpt-6.1-sol",
    fast: true,
  };
  assert.equal(getFastTierMarker(model, status, undefined), "⚡");
  assert.equal(
    getFastTierMarker(model, status, {
      ...status,
      applied: true,
    }),
    "⚡",
  );
  assert.equal(
    getFastTierMarker(model, status, {
      ...status,
      applied: false,
    }),
    "!⚡",
  );
  assert.equal(
    getFastTierMarker(model, status, {
      ...status,
      modelId: "gpt-6-sol",
      applied: false,
    }),
    "⚡",
  );
});

test("does not mark inactive or different models/providers", () => {
  assert.equal(
    hasActiveFastTierMarker(model, {
      provider: "openai-codex",
      modelId: "gpt-6.1-sol",
      fast: false,
    }),
    false,
  );
  assert.equal(
    hasActiveFastTierMarker(model, {
      provider: "openai",
      modelId: "gpt-6.1-sol",
      fast: true,
    }),
    false,
  );
  assert.equal(
    hasActiveFastTierMarker(model, {
      provider: "openai-codex",
      modelId: "gpt-6-sol",
      fast: true,
    }),
    false,
  );
});
