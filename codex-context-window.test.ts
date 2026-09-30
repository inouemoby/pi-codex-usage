import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_GPT_CONTEXT_OVERRIDES,
  CODEX_GPT_CONTEXT_WINDOW,
  getCodexGptContextWindow,
} from "./codex-context-window.ts";

test("defaults GPT 5.6 and later Codex models to 512K", () => {
  for (const id of [
    "gpt-5.6-sol",
    "gpt-6-astra",
    "gpt-6.1-sol",
    "gpt-7-future-model",
    "GPT-8-future-model",
  ]) {
    assert.equal(
      getCodexGptContextWindow({ provider: "openai-codex", id }),
      CODEX_GPT_CONTEXT_WINDOW,
    );
  }
});

test("explicit model rules take precedence over the automatic default", () => {
  assert.deepEqual(CODEX_GPT_CONTEXT_OVERRIDES, {
    "gpt-5.6-luna": 1_000_000,
    "gpt-5.6-terra": 1_000_000,
  });
  assert.equal(
    getCodexGptContextWindow(
      { provider: "openai-codex", id: "gpt-5.6-sol" },
      { "gpt-5.6-sol": 1_000_000 },
    ),
    1_000_000,
  );
});

test("leaves older GPT versions, non-GPT IDs, and other providers unchanged", () => {
  for (const id of ["gpt-4.1", "gpt-5.5-codex"]) {
    assert.equal(
      getCodexGptContextWindow({ provider: "openai-codex", id }),
      undefined,
    );
  }
  assert.equal(
    getCodexGptContextWindow({ provider: "openai-codex", id: "o3" }),
    undefined,
  );
  assert.equal(
    getCodexGptContextWindow({ provider: "openai", id: "gpt-7-future-model" }),
    undefined,
  );
  assert.equal(
    getCodexGptContextWindow({ provider: "openai-codex", id: undefined }),
    undefined,
  );
});
