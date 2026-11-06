import assert from "node:assert/strict";
import test from "node:test";
import {
  getFastTierMarker,
  getServiceTierWidgetState,
} from "./service-tier-marker.ts";

const model = { provider: "openai-codex", id: "gpt-6.1-sol" };
const fastStatus = {
  provider: "openai-codex",
  modelId: "gpt-6.1-sol",
  fast: true,
};

test("Fast shows only a bolt directly against the model name", () => {
  assert.equal(getFastTierMarker(model, fastStatus), "⚡");
  assert.equal(`${model.id}${getFastTierMarker(model, fastStatus)}`, "gpt-6.1-sol⚡");
});

test("turning Fast off removes the marker and turning it on restores it", () => {
  assert.equal(getFastTierMarker(model, { ...fastStatus, fast: false }), "");
  assert.equal(getFastTierMarker(model, fastStatus), "⚡");
});

test("reads active state from pi-service-tier footer widget events", () => {
  const event = (text: string) => ({
    protocol: 1,
    type: "upsert",
    widget: {
      id: "pi-service-tier.service-tier",
      content: { type: "text", text },
    },
  });

  assert.equal(getServiceTierWidgetState(event("⚡")), true);
  assert.equal(getServiceTierWidgetState(event("⚡⚡")), true);
  assert.equal(getServiceTierWidgetState(event("")), false);
  assert.equal(
    getServiceTierWidgetState({
      type: "remove",
      id: "pi-service-tier.service-tier",
    }),
    false,
  );
  assert.equal(
    getServiceTierWidgetState({ ...event("⚡"), widget: { id: "other" } }),
    undefined,
  );
});

test("missing state/model and mismatched provider/model show no marker", () => {
  assert.equal(getFastTierMarker(model, undefined), "");
  assert.equal(getFastTierMarker(undefined, fastStatus), "");
  assert.equal(getFastTierMarker(model, { ...fastStatus, provider: "openai" }), "");
  assert.equal(getFastTierMarker(model, { ...fastStatus, modelId: "gpt-6-luna" }), "");
});
