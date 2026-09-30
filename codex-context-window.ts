export const CODEX_GPT_CONTEXT_WINDOW = 512_000;

export function getCodexGptContextWindow(model: {
  provider?: unknown;
  id?: unknown;
}): number | undefined {
  return model.provider === "openai-codex" &&
    typeof model.id === "string" &&
    /^gpt-/i.test(model.id)
    ? CODEX_GPT_CONTEXT_WINDOW
    : undefined;
}
