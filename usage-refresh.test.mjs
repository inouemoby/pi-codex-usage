import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const pluginDir = join(import.meta.dirname);
const chunksDir = join(process.env.APPDATA, 'npm', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'chunks');
const chunk = readdirSync(chunksDir).find((name) => name.endsWith('.js') &&
  readFileSync(join(chunksDir, name), 'utf8').includes('async _runAgentPrompt(messages){'));
assert.ok(chunk, 'Installed Pi bundle is not available');
const { discoverAndLoadExtensions } = await import(pathToFileURL(join(chunksDir, chunk)).href);

test('assistant-message refreshes include tool calls but reuse the shared 60-second cache', async () => {
  const previousNow = Date.now;
  const previousProfile = process.env.USERPROFILE;
  const previousCodexHome = process.env.CODEX_HOME;
  const previousFetch = globalThis.fetch;
  const profile = previousProfile || process.env.HOME;
  const tempRoot = join(profile, 'Temp');
  const tempRootExisted = existsSync(tempRoot);
  mkdirSync(tempRoot, { recursive: true });
  const testHome = mkdtempSync(join(tempRoot, 'pi-codex-usage-refresh-'));
  const codexHome = join(testHome, '.codex');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, 'auth.json'), JSON.stringify({
    tokens: { access_token: 'test-access', refresh_token: 'test-refresh', account_id: 'test-account' },
  }));
  process.env.USERPROFILE = testHome;
  process.env.CODEX_HOME = codexHome;

  let now = 1_700_000_000_000;
  Date.now = () => now;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        rate_limit: {
          primary_window: {
            used_percent: 10,
            limit_window_seconds: 5 * 60 * 60,
            reset_at: Math.floor(Date.now() / 1000) + 3600,
          },
        },
      }),
      text: async () => '',
    };
  };

  try {
    const loaded = await discoverAndLoadExtensions([join(pluginDir, 'index.ts')], pluginDir, pluginDir);
    assert.deepEqual(loaded.errors, []);
    const extension = loaded.extensions[0];
    loaded.runtime.getThinkingLevel = () => "off";
    const ctx = {
      model: { provider: 'openai-codex', id: 'gpt-6-luna' },
      ui: { setFooter() {} },
    };
    const emit = async (eventName, event) => {
      for (const handler of extension.handlers.get(eventName) ?? []) await handler(event, ctx);
    };

    await emit('session_start', { type: 'session_start', reason: 'startup' });
    assert.equal(fetchCount, 1, 'session start performs an initial usage fetch');

    await emit('message_end', { type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse' } });
    assert.equal(fetchCount, 1, 'tool-call assistant message checks usage but reuses the fresh cache');

    await emit('message_end', { type: 'message_end', message: { role: 'toolResult' } });
    assert.equal(fetchCount, 1, 'tool results are not provider interactions');

    await emit('message_end', { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
    assert.equal(fetchCount, 1, 'assistant response after the tool call still uses the cache');

    now += 60_001;
    await Promise.all([
      emit('message_end', { type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse' } }),
      emit('message_end', { type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse' } }),
    ]);
    assert.equal(fetchCount, 2, 'after cache expiry, concurrent interaction refreshes share one request');

    await emit('agent_end', { type: 'agent_end', messages: [] });
    assert.equal(fetchCount, 2, 'agent_end does not issue a duplicate refresh');
  } finally {
    Date.now = previousNow;
    globalThis.fetch = previousFetch;
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    rmSync(testHome, { recursive: true, force: true });
    if (!tempRootExisted) rmSync(tempRoot, { recursive: true, force: true });
  }
});
