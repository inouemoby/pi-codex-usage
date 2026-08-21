import type { AssistantMessage } from "@earendil-works/pi-ai";
import { type ExtensionAPI, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";

// ─── Constants ───────────────────────────────────────────────────
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

const CACHE_MS = 60_000;
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Refresh the access token 1h before its real expiry (JWT `exp`).
const REFRESH_MARGIN_MS = 60 * 60 * 1000;

// pi's catalogue currently advertises GPT-5.6 Luna as 272K. Keep the
// override local to this extension so compaction and context display use 512K.
const LUNA_CONTEXT_WINDOW = 512_000;

// ─── Types ───────────────────────────────────────────────────────
interface RateWindow {
  used_percent: number;
  limit_window_seconds: number;
  reset_after_seconds: number;
  reset_at: number; // epoch SECONDS
}

interface ExtraLimit {
  id: string;
  label: string;
  used_percent: number;
  reset_at: number; // epoch seconds
  window_seconds: number;
}

interface UsageData {
  plan: string;
  email: string;
  fiveHourPercent: number; // -1 when window absent / null
  fiveHourResetMs: number;
  weeklyPercent: number; // -1 when window absent / null
  weeklyResetMs: number;
  creditsBalance: string;
  hasCredits: boolean;
  unlimited: boolean;
  limitReached: boolean;
  extraLimits: ExtraLimit[];
  _ts: number;
}

interface TokenSource {
  access: string;
  refresh: string;
  accountId?: string;
  expires?: number; // epoch ms — pi's own field on the stored credential
  origin: "pi-auth" | "codex-auth";
  path: string; // write-back target
}

// ─── Token Storage ───────────────────────────────────────────────
function getPiAuthPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return resolve(home, ".pi", "agent", "auth.json");
}

function getCodexAuthPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const codexHome = process.env.CODEX_HOME || resolve(home, ".codex");
  return resolve(codexHome, "auth.json");
}

/**
 * Resolve Codex OAuth credentials in priority order:
 *   1. pi auth config  (~/.pi/agent/auth.json → "openai-codex")
 *   2. Codex CLI       (~/.codex/auth.json → tokens, honors $CODEX_HOME)
 */
function readTokenSource(): TokenSource | null {
  // 1. Official pi API: the credential pi's `/login openai-codex` persists to
  //    ~/.pi/agent/auth.json. `readStoredCredential` is exported by
  //    pi-coding-agent and is the canonical way to read it — no manual file
  //    parsing, and it tracks pi's stored schema automatically.
  try {
    const cred = readStoredCredential("openai-codex");
    if (cred?.type === "oauth" && cred.access && cred.refresh) {
      return {
        access: cred.access, refresh: cred.refresh,
        accountId: cred.accountId, expires: cred.expires,
        origin: "pi-auth", path: getPiAuthPath(),
      };
    }
  } catch { /* fall through */ }

  // 2. Codex CLI auth.json (~/.codex/auth.json, or $CODEX_HOME/auth.json)
  try {
    const p = getCodexAuthPath();
    if (existsSync(p)) {
      const auth = JSON.parse(readFileSync(p, "utf-8"));
      const t = auth?.tokens;
      if (t?.access_token && t?.refresh_token) {
        return {
          access: t.access_token, refresh: t.refresh_token,
          accountId: t.account_id, origin: "codex-auth", path: p,
        };
      }
    }
  } catch { /* fall through */ }

  return null;
}

function decodeJwtExpMs(token: string): number {
  try {
    const payload = token.split(".")[1] ?? "";
    // JWT uses base64url without padding.
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
    return typeof json.exp === "number" ? json.exp * 1000 : 0;
  } catch { return 0; }
}

function isTokenExpired(src: TokenSource): boolean {
  // Prefer pi's own `expires` field (epoch ms) — kept fresh by pi's ModelRuntime
  // whenever it uses the openai-codex provider. Falls back to the JWT `exp`
  // claim only for the codex-auth origin, which has no `expires` field.
  if (src.expires && src.expires > 0) return Date.now() > src.expires - REFRESH_MARGIN_MS;
  const exp = decodeJwtExpMs(src.access);
  if (exp > 0) return Date.now() > exp - REFRESH_MARGIN_MS;
  // No expiry info — be conservative, treat as fresh.
  return false;
}

/** Atomically rotate the refreshed tokens back into the source file. */
function writeBackToken(src: TokenSource, access: string, refresh: string, accountId?: string): void {
  try {
    const data = JSON.parse(readFileSync(src.path, "utf-8"));
    if (src.origin === "pi-auth") {
      const prev = data["openai-codex"] ?? {};
      const exp = decodeJwtExpMs(access);
      data["openai-codex"] = {
        ...prev,
        type: "oauth",
        access, refresh,
        expires: exp > 0 ? exp : (Date.now() + 864000 * 1000),
        accountId: accountId || prev.accountId,
      };
    } else {
      // codex-auth: preserve every existing field, only rotate tokens + timestamp.
      const prevTokens = data.tokens ?? {};
      data.tokens = {
        ...prevTokens,
        access_token: access,
        refresh_token: refresh,
      };
      if (accountId) data.tokens.account_id = accountId;
      data.last_refresh = new Date().toISOString();
    }
    const tmp = src.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, src.path);
  } catch { /* best-effort: refresh_token rotation is preferred but not fatal */ }
}

// ─── Refresh ─────────────────────────────────────────────────────
async function doRefresh(src: TokenSource): Promise<TokenSource> {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: src.refresh,
      client_id: CLIENT_ID,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`token refresh failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  const j = (await resp.json()) as {
    access_token?: string; refresh_token?: string; expires_in?: number;
  };
  if (!j.access_token || !j.refresh_token) {
    throw new Error("refresh response missing access_token / refresh_token");
  }
  // refresh_token is rotated on every refresh — must persist, else next launch loses auth.
  writeBackToken(src, j.access_token, j.refresh_token, src.accountId);
  return { ...src, access: j.access_token, refresh: j.refresh_token };
}

// Concurrency guard: never run two refreshes at once (rotating token would conflict).
let _refreshPromise: Promise<TokenSource> | null = null;
function ensureFreshToken(src: TokenSource): Promise<TokenSource> {
  if (!isTokenExpired(src)) return Promise.resolve(src);
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = doRefresh(src).finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

// ─── Helpers ─────────────────────────────────────────────────────
/** Returns severity: 0=normal, 1=above expected, 2=critical (1.5x expected) */
function usageSeverity(pct: number, windowMs: number, resetMs: number): number {
  if (resetMs <= 0) return 0;
  const remainingMs = resetMs - Date.now();
  const elapsedMs = Math.max(0, windowMs - remainingMs);
  const elapsedRatio = elapsedMs / windowMs;
  const expectedPct = elapsedRatio * 100;
  if (pct > expectedPct * 1.5) return 2;
  if (pct > expectedPct)      return 1;
  return 0;
}

function humanDuration(untilMs: number): string {
  if (untilMs <= 0) return "now";
  const m = Math.floor(untilMs / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mins}m`;
  return `${mins}m`;
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1e6) return `${Math.round(count / 1000)}k`;
  if (count < 1e7) return `${(count / 1e6).toFixed(1)}M`;
  return `${Math.round(count / 1e6)}M`;
}

// ─── Fetch ───────────────────────────────────────────────────────
/**
 * Map a WHAM rate window onto the 5h / weekly buckets using its duration.
 * OpenAI assigns primary/secondary differently per plan, so classify by
 * limit_window_seconds rather than by field name.
 *   ≤ 6h  → 5-hour burst window
 *   > 6h  → weekly window
 */
function bucketOf(w: RateWindow | null): "fiveHour" | "weekly" | null {
  if (!w) return null;
  return (w.limit_window_seconds || 0) <= 21600 ? "fiveHour" : "weekly";
}

async function fetchUsage(src: TokenSource): Promise<UsageData> {
  const fresh = await ensureFreshToken(src);
  const resp = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${fresh.access}`, Accept: "application/json" },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${text.slice(0, 160)}`);
  }
  const j = await resp.json();

  const rl = j.rate_limit ?? {};
  const pw: RateWindow | null = rl.primary_window ?? null;
  const sw: RateWindow | null = rl.secondary_window ?? null;

  let fiveHourPercent = -1, fiveHourResetMs = 0;
  let weeklyPercent = -1, weeklyResetMs = 0;
  const assign = (w: RateWindow | null) => {
    const b = bucketOf(w);
    if (b === "fiveHour") {
      fiveHourPercent = w!.used_percent;
      fiveHourResetMs = w!.reset_at ? w!.reset_at * 1000 : 0;
    } else if (b === "weekly") {
      weeklyPercent = w!.used_percent;
      weeklyResetMs = w!.reset_at ? w!.reset_at * 1000 : 0;
    }
  };
  assign(pw);
  assign(sw);

  // Model-specific extra limits (e.g. Codex Spark) — best effort.
  const extraLimits: ExtraLimit[] = [];
  const arl: any[] = j.additional_rate_limits ?? [];
  for (const e of arl) {
    const lim = e?.rate_limit ?? e;
    const win = lim?.primary_window ?? lim?.window;
    if (win?.used_percent !== undefined && win?.reset_at) {
      extraLimits.push({
        id: e?.id ?? e?.limit_id ?? "extra",
        label: e?.name ?? e?.label ?? e?.id ?? "extra",
        used_percent: win.used_percent,
        reset_at: win.reset_at,
        window_seconds: win.limit_window_seconds ?? 0,
      });
    }
  }

  const credits = j.credits ?? {};

  return {
    plan: j.plan_type ?? "unknown",
    email: j.email ?? "",
    fiveHourPercent, fiveHourResetMs,
    weeklyPercent, weeklyResetMs,
    creditsBalance: String(credits.balance ?? "0"),
    hasCredits: !!credits.has_credits,
    unlimited: !!credits.unlimited,
    limitReached: !!rl.limit_reached,
    extraLimits,
    _ts: Date.now(),
  };
}

// ─── Main ────────────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
  let tokenSrc: TokenSource | null = null;
  let usage: UsageData | null = null;
  let footerOn = false;
  let _tui: any = null;
  let latestCtx: any = null;
  let thinkingLevel = "off";

  async function getUsage(): Promise<UsageData> {
    if (!tokenSrc) throw new Error(
      "Codex credentials not found. Sign in with `codex login` or pi `/auth openai-codex`.",
    );
    if (usage && Date.now() - usage._ts < CACHE_MS) return usage;
    usage = await fetchUsage(tokenSrc);
    return usage;
  }

  function isCodex(ctx: any) {
    const p = ctx.model?.provider?.toLowerCase() ?? "";
    // openai-codex provider, or any openai/codex model using the ChatGPT subscription.
    return p.includes("codex") || (p.includes("openai") && !p.includes("realtime"));
  }

  function forceLunaContextWindow(ctx: any) {
    const candidates: any[] = [];
    if (ctx.model) candidates.push(ctx.model);
    try { candidates.push(...(ctx.modelRegistry?.getAll?.() ?? [])); } catch { /* unavailable during startup */ }
    for (const model of candidates) {
      if (model?.provider === "openai-codex" && model?.id === "gpt-5.6-luna") {
        model.contextWindow = LUNA_CONTEXT_WINDOW;
      }
    }
  }

  function trigger() {
    setTimeout(() => {
      try { _tui?.requestRender?.(); } catch { /* footer disposed */ }
    }, 0);
  }

  // ── Refresh ─────────────────────────────────────────────────
  async function refresh(ctx: any) {
    if (!tokenSrc) return;
    if (!isCodex(ctx)) {
      if (usage) { usage = null; toggleFooter(ctx); }
      return;
    }
    try { await getUsage(); trigger(); } catch { /* silent */ }
  }

  // ── Footer ──────────────────────────────────────────────────
  function toggleFooter(ctx: any) {
    if (isCodex(ctx) && tokenSrc) {
      if (!footerOn) {
        ctx.ui.setFooter(buildFooter(ctx));
        footerOn = true;
      }
    } else {
      if (footerOn) {
        _tui = null;
        ctx.ui.setFooter(undefined as any);
        footerOn = false;
      }
    }
  }

  function buildFooter(ctx: any) {
    return (tui: any, theme: any, fd: any) => {
      _tui = tui;
      const unsub = fd.onBranchChange(() => tui.requestRender());
      return {
        dispose: () => { unsub(); _tui = null; footerOn = false; },
        invalidate() {},
        render(width: number): string[] {
          const sm = ctx.sessionManager;

          // ── Line 1: pwd ──────────────────────────────────
          const home = process.env.HOME || process.env.USERPROFILE || "";
          let pwd = ctx.cwd || sm.getCwd?.() || "";
          if (home && pwd.startsWith(home)) pwd = "~" + pwd.slice(home.length);
          const branch = fd.getGitBranch();
          if (branch) pwd += ` (${branch})`;
          const sname = sm.getSessionName?.();
          if (sname) pwd += ` • ${sname}`;
          const ln1 = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));

          // ── Line 2: stats ────────────────────────────────
          let ti = 0, to = 0, tr = 0, tw = 0, tc = 0;
          for (const e of sm.getEntries()) {
            if (e.type === "message" && e.message?.role === "assistant") {
              const u = (e.message as AssistantMessage).usage;
              ti += u.input; to += u.output;
              tr += u.cacheRead; tw += u.cacheWrite;
              tc += u.cost.total;
            }
          }
          const parts: string[] = [];
          const cachePartIndexes: number[] = [];
          let costPartIndex = -1;
          if (ti) parts.push(`↑${formatTokens(ti)}`);
          if (to) parts.push(`↓${formatTokens(to)}`);
          if (tr) { cachePartIndexes.push(parts.length); parts.push(`R${formatTokens(tr)}`); }
          if (tw) { cachePartIndexes.push(parts.length); parts.push(`W${formatTokens(tw)}`); }
          if (tc) { costPartIndex = parts.length; parts.push(`$${tc.toFixed(3)}`); }

          // Context %
          const cu = ctx.getContextUsage();
          const cw = cu?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const raw = cu?.percent;
          const cp = raw !== null && raw !== undefined ? raw.toFixed(1) : "?";
          let cpStr: string;
          if (cp === "?") cpStr = `?/${formatTokens(cw)} (auto)`;
          else if (parseFloat(cp) > 90) cpStr = theme.fg("error", `${cp}%/${formatTokens(cw)} (auto)`);
          else if (parseFloat(cp) > 70) cpStr = theme.fg("warning", `${cp}%/${formatTokens(cw)} (auto)`);
          else cpStr = `${cp}%/${formatTokens(cw)} (auto)`;
          parts.push(cpStr);

          // Codex usage
          if (usage) {
            if (usage.fiveHourPercent >= 0) {
              const sev = usageSeverity(usage.fiveHourPercent, FIVE_HOUR_MS, usage.fiveHourResetMs);
              const flag = sev === 2 ? "!!" : sev === 1 ? "!" : "";
              parts.push(`${flag}5h:${usage.fiveHourPercent}%`);
            }
            if (usage.weeklyPercent >= 0) {
              const sev = usageSeverity(usage.weeklyPercent, WEEK_MS, usage.weeklyResetMs);
              const flag = sev === 2 ? "!!" : sev === 1 ? "!" : "";
              parts.push(`${flag}wk:${usage.weeklyPercent}%`);
            }
          }
          // Right side: model info. Provider is the first thing omitted when
          // the line is too wide; cache counters and then cost are removed next.
          const m = ctx.model;
          let modelText = m?.id || "no-model";
          if (m?.reasoning) {
            const tl = thinkingLevel;
            modelText = tl === "off" ? `${modelText} • thinking off` : `${modelText} • ${tl}`;
          }
          const withProvider = m ? `(${m.provider}) ${modelText}` : modelText;
          let right = withProvider;
          let left = parts.join(" ");
          if (visibleWidth(left) + 2 + visibleWidth(right) > width) right = modelText;

          const fits = () => visibleWidth(left) + 2 + visibleWidth(right) <= width;
          if (!fits()) {
            for (const index of cachePartIndexes) parts[index] = "";
            left = parts.filter(Boolean).join(" ");
          }
          if (!fits() && costPartIndex >= 0) {
            parts[costPartIndex] = "";
            left = parts.filter(Boolean).join(" ");
          }

          const lw = visibleWidth(left);
          const rw = visibleWidth(right);
          let ln2: string;
          if (lw + 2 + rw <= width) {
            ln2 = left + " ".repeat(width - lw - rw) + right;
          } else if (lw + 2 < width) {
            ln2 = truncateToWidth(left + "  " + right, width, "");
          } else {
            ln2 = truncateToWidth(left, width, "...");
          }

          return [ln1, theme.fg("dim", ln2)];
        },
      };
    };
  }

  // ── Events ─────────────────────────────────────────────────
  pi.on("session_start", async (_e, ctx) => {
    latestCtx = ctx;
    forceLunaContextWindow(ctx);
    tokenSrc = readTokenSource();
    thinkingLevel = pi.getThinkingLevel?.() || "off";
    footerOn = false;
    toggleFooter(ctx);
    if (tokenSrc) refresh(ctx);
  });

  pi.on("model_select", async (_e, ctx) => {
    latestCtx = ctx;
    forceLunaContextWindow(ctx);
    if (isCodex(ctx)) {
      // Let the previous usage extension unmount first when switching providers.
      setTimeout(() => {
        toggleFooter(ctx);
        if (tokenSrc) refresh(ctx);
      }, 0);
    } else {
      // Vacate the footer immediately so the target provider can take it over.
      toggleFooter(ctx);
      if (tokenSrc) refresh(ctx);
    }
  });
  pi.on("thinking_level_select", async (event: any) => { thinkingLevel = event.level || "off"; trigger(); });
  pi.on("agent_start", async (_e, ctx) => {
    latestCtx = ctx;
    // Re-apply after any late model-catalog refresh.
    forceLunaContextWindow(ctx);
  });
  pi.on("agent_end", async (_e, ctx) => { latestCtx = ctx; if (tokenSrc) refresh(ctx); });

  // ── /codex ───────────────────────────────────────────────
  pi.registerCommand("codex", {
    description: "Show OpenAI Codex (ChatGPT subscription) usage",
    handler: async (_args, ctx) => {
      try {
        const d = await getUsage();
        const bar = (pct: number) =>
          "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));

        const lines = [`══ Codex / ChatGPT ${d.plan.toUpperCase()} ══`];
        if (d.email) lines.push(`account: ${d.email}`);

        if (d.fiveHourPercent >= 0) {
          lines.push(
            `5h  ${bar(d.fiveHourPercent)}  ${d.fiveHourPercent}% used  (${(100 - d.fiveHourPercent).toFixed(1)}% left)  resets ${humanDuration(d.fiveHourResetMs - Date.now())}`,
          );
        }
        if (d.weeklyPercent >= 0) {
          lines.push(
            `wk  ${bar(d.weeklyPercent)}  ${d.weeklyPercent}% used  (${(100 - d.weeklyPercent).toFixed(1)}% left)  resets ${humanDuration(d.weeklyResetMs - Date.now())}`,
          );
        }

        // Credits
        if (d.unlimited) {
          lines.push("credits: unlimited");
        } else if (d.hasCredits) {
          lines.push(`credits: $${d.creditsBalance}`);
        }

        // Extra model-specific limits
        for (const e of d.extraLimits) {
          lines.push(
            `${e.label}  ${bar(e.used_percent)}  ${e.used_percent}%  resets ${humanDuration(e.reset_at * 1000 - Date.now())}`,
          );
        }

        if (d.limitReached) lines.push("⚠ rate limit reached — usage is currently blocked.");
        ctx.ui.notify(lines.join("\n"), "info");
      } catch (err: any) {
        ctx.ui.notify(`Codex: ${err.message}`, "error");
      }
    },
  });

  // ── codex_usage tool ──────────────────────────────────────
  pi.registerTool({
    name: "codex_usage",
    label: "Codex Usage",
    description: "Get current OpenAI Codex usage.",
    parameters: Type.Object({}),
    async execute() {
      try {
        const d = await getUsage();
        const result: any = {
          plan: d.plan,
          // NOTE: email intentionally omitted — tool results are sent to the
          // active LLM provider, which may be a third party. Use `/codex` to
          // see the account email locally.
          fiveHour: d.fiveHourPercent >= 0 ? {
            usedPercent: d.fiveHourPercent,
            remainingPercent: +(100 - d.fiveHourPercent).toFixed(1),
            resetsIn: humanDuration(d.fiveHourResetMs - Date.now()),
          } : null,
          weekly: d.weeklyPercent >= 0 ? {
            usedPercent: d.weeklyPercent,
            remainingPercent: +(100 - d.weeklyPercent).toFixed(1),
            resetsIn: humanDuration(d.weeklyResetMs - Date.now()),
          } : null,
          credits: {
            balance: d.creditsBalance,
            hasCredits: d.hasCredits,
            unlimited: d.unlimited,
          },
          limitReached: d.limitReached,
        };
        if (d.extraLimits.length) {
          result.extraLimits = d.extraLimits.map((e) => ({
            label: e.label,
            usedPercent: e.used_percent,
            resetsIn: humanDuration(e.reset_at * 1000 - Date.now()),
          }));
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    },
  });
}
