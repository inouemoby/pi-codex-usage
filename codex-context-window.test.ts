import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_GPT_CONTEXT_WINDOW,
  getCodexGptContextWindow,
} from "./codex-context-window.ts";

test("assigns 512K to current and future GPT Codex model IDs", () => {
  for (const id of [
    "gpt-5.6-luna",
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

test("does not override non-GPT IDs or other providers", () => {
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
