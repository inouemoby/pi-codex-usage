import assert from "node:assert/strict";
import test from "node:test";

import {
  displayQuotaPercent,
  resolveQuotaDisplayMode,
} from "./quota-display.ts";

test("defaults to displaying used quota", () => {
  assert.equal(resolveQuotaDisplayMode(undefined), "used");
  assert.equal(resolveQuotaDisplayMode({}), "used");
  assert.equal(resolveQuotaDisplayMode({ quotaDisplay: "invalid" }), "used");
  assert.equal(displayQuotaPercent(32, "used"), 32);
});

test("supports displaying remaining quota", () => {
  const mode = resolveQuotaDisplayMode({ quotaDisplay: "remaining" });

  assert.equal(mode, "remaining");
  assert.equal(displayQuotaPercent(2, mode), 98);
  assert.equal(displayQuotaPercent(32, mode), 68);
  assert.equal(displayQuotaPercent(100, mode), 0);
  assert.equal(displayQuotaPercent(105, mode), 0);
});
