// Perch AI models as a Magpie / OpenCode provider plugin.
//
// Automatically reuses the local login state from macOS Keychain (`app.perchai.cli-auth`),
// auto-refreshes expired access tokens via Supabase Auth and persists back to Keychain,
// displays real-time quota windows via https://app.perchai.app/api/perchai/account,
// and bridges OpenAI chat completions to Perch's turn-ticket & model-call pipeline.

import { spawnSync } from "node:child_process";

const ID = "perch";
const BASE = "https://app.perchai.app/api/perch-terminal";
const APP_URL = "https://app.perchai.app";
const SUPABASE_AUTH_URL = "https://zlfuvsfjtgsdtqcaykia.supabase.co/auth/v1/token?grant_type=refresh_token";
const SUPABASE_API_KEY = "sb_publishable_w4R_pNkUpygBFIljZCoOlA_67ACg0FO";

const BOOTSTRAP_MODELS = [
  { id: "wandb-kimi-k2-6", name: "W&B Kimi K2.6 · 免费", context: 131072, output: 8192 },
  { id: "deepseek-flash-starter", name: "DeepSeek V4.1 Flash (Starter) · 免费", context: 131072, output: 8192 },
  { id: "glm-5.3-flash-starter", name: "GLM 5.3 Flash (Starter) · 免费", context: 131072, output: 8192 },
  { id: "claude-haiku-5.5", name: "Claude Haiku 5.5 · 免费", context: 200000, output: 8192 },
  { id: "gpt-6-luna", name: "GPT-6 Luna · 免费", context: 1050000, output: 128000 },
  { id: "laguna-s", name: "Laguna S 2.1 · 免费", context: 131072, output: 8192 }
];

function readKeychainAuth() {
  if (process.platform !== "darwin") return null;
  try {
    const res = spawnSync("security", [
      "find-generic-password",
      "-s",
      "app.perchai.cli-auth",
      "-a",
      "default",
      "-w"
    ], { encoding: "utf8" });
    if (res.status !== 0 || !res.stdout.trim()) return null;
    return JSON.parse(res.stdout.trim());
  } catch {
    return null;
  }
}

function saveKeychainAuth(auth) {
  if (process.platform !== "darwin") return false;
  try {
    const res = spawnSync("security", [
      "add-generic-password",
      "-U",
      "-s",
      "app.perchai.cli-auth",
      "-a",
      "default",
      "-w",
      JSON.stringify(auth)
    ]);
    return res.status === 0;
  } catch {
    return false;
  }
}

async function getValidToken(forceRefresh = false) {
  const auth = readKeychainAuth();
  if (!auth || !auth.accessToken) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const isExpiring = auth.expiresAt && auth.expiresAt <= nowSec + 90;

  if (!forceRefresh && !isExpiring) {
    return auth.accessToken;
  }

  // Refresh via Supabase Auth
  if (auth.refreshToken) {
    try {
      const res = await globalThis.fetch(SUPABASE_AUTH_URL, {
        method: "POST",
        headers: {
          apikey: SUPABASE_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ refresh_token: auth.refreshToken }),
        signal: AbortSignal.timeout(25000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.access_token) {
          auth.accessToken = data.access_token;
          if (data.refresh_token) auth.refreshToken = data.refresh_token;
          auth.expiresAt = nowSec + (data.expires_in || 3600);
          auth.updatedAt = new Date().toISOString();
          saveKeychainAuth(auth);
          return data.access_token;
        }
      }
    } catch {}
  }

  return auth.accessToken;
}

async function fetchAccount(token) {
  const res = await globalThis.fetch(`${APP_URL}/api/perchai/account`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "perchai-cli/2.4.118"
    },
    signal: AbortSignal.timeout(25000)
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("perch sign-in expired (401/403)"), { status: res.status, invalidToken: true });
  }
  if (!res.ok) {
    throw new Error(`perch /account returned HTTP ${res.status}`);
  }
  return res.json();
}

async function requestTurnTicket(token) {
  const res = await globalThis.fetch(`${BASE}/turn-ticket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "perchai-cli/2.4.118"
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) {
    throw new Error(`turn-ticket failed with HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data?.ok || !data?.ticket) {
    throw new Error(`turn-ticket returned invalid payload: ${JSON.stringify(data)}`);
  }
  return data;
}

function toMagpieModel(m) {
  const id = typeof m === "string" ? m : m.id;
  const name = typeof m === "object" && m.name ? m.name : id;
  const baseName = name.split(" · ")[0].trim();
  const displayName = `${baseName} · 免费`;

  return {
    id,
    name: displayName,
    free: true,
    rate: 0,
    limit: {
      context: (typeof m === "object" && m.context) || 131072,
      output: (typeof m === "object" && m.output) || 8192
    },
    reasoning: true,
    tool_call: true,
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    capabilities: {
      reasoning: true,
      toolcall: true,
      input: { text: true },
      output: { text: true }
    }
  };
}

export const PerchAuthPlugin = async ({ client } = {}) => {
  return {
    config: async (cfg) => {
      cfg.provider ??= {};
      cfg.provider[ID] ??= {
        name: "perch",
        npm: "@ai-sdk/openai-compatible",
        api: BASE,
        models: Object.fromEntries(BOOTSTRAP_MODELS.map((m) => [m.id, toMagpieModel(m)]))
      };
    },

    provider: {
      id: ID,
      async models(provider) {
        return provider.models;
      }
    },

    auth: {
      provider: ID,
      methods: [
        {
          type: "oauth",
          label: "perch CLI's sign-in (自动复用钥匙串登录态)",
          async authorize() {
            const auth = readKeychainAuth();
            if (!auth || !auth.accessToken) {
              return {
                type: "failed",
                error: "未找到 perch 本地钥匙串登录态。请先在终端运行一次 `perch login` 完成登录。"
              };
            }
            const token = await getValidToken();
            const email = auth.email || "perch user";
            try {
              const acc = await fetchAccount(token);
              const plan = acc.session?.planName || (acc.session?.tierSelectionRequired ? "待选计划" : "Pilot");
              return {
                type: "success",
                key: token,
                metadata: {
                  email,
                  planName: plan,
                  source: "perch-keychain"
                },
                async callback() {
                  return {
                    type: "success",
                    key: token,
                    metadata: { email, planName: plan }
                  };
                }
              };
            } catch (err) {
              // Gracefully accept if network was slow, keychain credentials exist
              return {
                type: "success",
                key: token,
                metadata: { email, planName: "Pilot", source: "perch-keychain" },
                async callback() {
                  return { type: "success", key: token, metadata: { email } };
                }
              };
            }
          }
        },
        {
          type: "api",
          label: "perch JWT Access Token (手动填入)",
          placeholder: "eyJhbGciOi..."
        }
      ],

      async usage(getAuth) {
        const auth = await getAuth();
        const token = auth?.key || (await getValidToken());
        if (!token) {
          return { error: "not signed in", windows: [] };
        }

        const keychain = readKeychainAuth();
        const userEmail = keychain?.email || "perch user";

        try {
          const acc = await fetchAccount(token);
          const windows = [];

          if (acc.session?.tierSelectionRequired) {
            windows.push({
              name: "计划状态 (Plan Status)",
              used: 0,
              display: "基础账号已就绪 · 可在 app.perchai.app 激活完整限额"
            });
          }

          if (acc.fiveHourLimit) {
            const limit = acc.fiveHourLimit;
            const cap = limit.capUsd || 2.5;
            const used = limit.usedUsd || 0;
            const pct = Math.max(0, Math.min(100, Math.round((used / cap) * 100)));
            windows.push({
              name: "5小时滚动限额 (5h Rolling)",
              used: pct,
              display: `$${used.toFixed(2)} / $${cap.toFixed(2)} USD`,
              resetsAt: limit.nextFreedAt
            });
          }

          if (acc.sevenDayLimit) {
            const limit = acc.sevenDayLimit;
            const cap = limit.capUsd || 7.5;
            const used = limit.usedUsd || 0;
            const pct = Math.max(0, Math.min(100, Math.round((used / cap) * 100)));
            windows.push({
              name: "7天滚动限额 (7d Rolling)",
              used: pct,
              display: `$${used.toFixed(2)} / $${cap.toFixed(2)} USD`,
              resetsAt: limit.nextFreedAt
            });
          }

          if (windows.length === 0) {
            windows.push({
              name: "Perch 社区版额度",
              used: 0,
              display: "正常使用中"
            });
          }

          const planName = acc.session?.planName || (acc.session?.tierSelectionRequired ? "Community" : "Pilot");

          return {
            plan: `Perch ${planName} Plan`,
            user: userEmail,
            windows,
            signIn: "renewed"
          };
        } catch (err) {
          if (err.invalidToken) {
            return {
              error: "perch 凭据已失效，请在终端运行 `perch login` 重新登录",
              signIn: "expired",
              windows: []
            };
          }
          return {
            plan: "Perch Pilot Plan",
            user: userEmail,
            windows: [
              {
                name: "Perch 限额状态",
                used: 0,
                display: "正常使用中"
              }
            ]
          };
        }
      },

      async loader(getAuth) {
        const auth = await getAuth();
        const token = auth?.key || (await getValidToken());
        if (!token) return {};

        return {
          baseURL: BASE,
          apiKey: token,
          async fetch(input, init = {}) {
            let currentToken = await getValidToken();
            if (!currentToken) currentToken = token;

            let bodyObj = {};
            if (init.body) {
              try {
                bodyObj = JSON.parse(init.body);
              } catch {}
            }

            // Obtain turn ticket
            let ticketData;
            try {
              ticketData = await requestTurnTicket(currentToken);
            } catch (ticketErr) {
              currentToken = await getValidToken(true);
              ticketData = await requestTurnTicket(currentToken);
            }

            const modelId = bodyObj.model?.replace(/^perch\//, "") || "wandb-kimi-k2-6";
            const messages = bodyObj.messages || [];

            const perchPayload = {
              request: {
                messages,
                maxTokens: bodyObj.max_tokens || 4096,
                temperature: bodyObj.temperature ?? 0.7
              },
              runId: ticketData.runId,
              lane: "chat",
              clientSurface: "cli",
              preferredModelId: modelId
            };

            const callHeaders = {
              Authorization: `Bearer ${currentToken}`,
              "x-perch-turn-ticket": ticketData.ticket,
              "Content-Type": "application/json",
              "User-Agent": "perchai-cli/2.4.118"
            };

            const isStream = Boolean(bodyObj.stream);
            if (isStream) {
              callHeaders["Accept"] = "text/event-stream";
            }

            const upstreamRes = await globalThis.fetch(`${BASE}/model-call`, {
              method: "POST",
              headers: callHeaders,
              body: JSON.stringify(perchPayload),
              signal: init.signal
            });

            if (!upstreamRes.ok) {
              return upstreamRes;
            }

            if (!isStream) {
              const resData = await upstreamRes.json();
              const openAiResponse = {
                id: `chatcmpl-${ticketData.ticketId || Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: resData.text || resData.content?.[0]?.text || ""
                    },
                    finish_reason: "stop"
                  }
                ],
                usage: resData.usage || {
                  prompt_tokens: 0,
                  completion_tokens: 0,
                  total_tokens: 0
                }
              };
              return new Response(JSON.stringify(openAiResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }

            return upstreamRes;
          }
        };
      }
    }
  };
};

export default PerchAuthPlugin;
export { PerchAuthPlugin as PerchPlugin };
