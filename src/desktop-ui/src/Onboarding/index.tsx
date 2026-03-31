import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Rocket } from "lucide-react";

import {
  ALL_AGENTS,
  DEFAULT_WECHAT_BASE_URL,
  STEPS,
} from "./constants";
import { StepAgents } from "./components/StepAgents";
import { StepChannels } from "./components/StepChannels";
import { StepConfirm } from "./components/StepConfirm";
import { StepTunnel } from "./components/StepTunnel";
import { StepWelcome } from "./components/StepWelcome";
import type {
  DiscoveredChannelPlugin,
  Settings,
  WechatQrStartResponse,
  WechatQrStatus,
  WechatQrWaitResponse,
} from "./types";
import type { AgentId, OnboardingStep, TunnelProvider } from "./constants";

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<Settings>({});
  const [discoveredPlugins, setDiscoveredPlugins] = useState<DiscoveredChannelPlugin[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [enabledAgents, setEnabledAgents] = useState<Set<AgentId>>(
    new Set(ALL_AGENTS)
  );
  const [defaultAgent, setDefaultAgent] = useState<AgentId>("claude");

  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [tgToken, setTgToken] = useState("");

  const [feishuEnabled, setFeishuEnabled] = useState(false);
  const [feishuAppId, setFeishuAppId] = useState("");
  const [feishuAppSecret, setFeishuAppSecret] = useState("");

  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordToken, setDiscordToken] = useState("");

  const [wechatEnabled, setWechatEnabled] = useState(false);
  const [wechatBaseUrl, setWechatBaseUrl] = useState(DEFAULT_WECHAT_BASE_URL);
  const [wechatBotToken, setWechatBotToken] = useState("");
  const [wechatAccountId, setWechatAccountId] = useState("");
  const [wechatQrStatus, setWechatQrStatus] = useState<WechatQrStatus>("idle");
  const [wechatQrCodeUrl, setWechatQrCodeUrl] = useState("");
  const [wechatQrSessionKey, setWechatQrSessionKey] = useState("");
  const [wechatQrMessage, setWechatQrMessage] = useState("");

  const [tunnelProvider, setTunnelProvider] = useState<TunnelProvider>("none");
  const [ngrokToken, setNgrokToken] = useState("");
  const [ngrokDomain, setNgrokDomain] = useState("");
  const [cfToken, setCfToken] = useState("");
  const [cfHostname, setCfHostname] = useState("");

  const [finishing, setFinishing] = useState(false);
  const waitingForWechatRef = useRef(false);

  const resetWechatQrState = useCallback((message = "") => {
    setWechatQrStatus("idle");
    setWechatQrCodeUrl("");
    setWechatQrSessionKey("");
    setWechatQrMessage(message);
    waitingForWechatRef.current = false;
  }, []);

  const cancelWechatSession = useCallback(
    async (options?: { keepMessage?: boolean; nextMessage?: string }) => {
      try {
        await invoke("wechat_qr_cancel", {
          request: {
            keepCredentials: true,
          },
        });
      } catch {
        // Ignore cancellation failures during teardown.
      } finally {
        if (options?.keepMessage) {
          setWechatQrCodeUrl("");
          setWechatQrSessionKey("");
          waitingForWechatRef.current = false;
        } else {
          resetWechatQrState(options?.nextMessage ?? "");
        }
      }
    },
    [resetWechatQrState]
  );

  useEffect(() => {
    Promise.all([
      invoke<Settings>("get_settings"),
      invoke<DiscoveredChannelPlugin[]>("list_channel_plugins"),
    ])
      .then(([loadedSettings, plugins]) => {
        setSettings(loadedSettings);
        setDiscoveredPlugins(plugins);
        if (loadedSettings.enabled_agents?.length) {
          setEnabledAgents(new Set(loadedSettings.enabled_agents as AgentId[]));
        }
        if (loadedSettings.default_agent) {
          setDefaultAgent(loadedSettings.default_agent as AgentId);
        }

        const telegramToken = loadedSettings.channels?.telegram?.bot_token ?? "";
        setTgToken(telegramToken);
        setTelegramEnabled(Boolean(telegramToken));

        const loadedFeishuAppId = loadedSettings.channels?.feishu?.app_id ?? "";
        const loadedFeishuAppSecret =
          loadedSettings.channels?.feishu?.app_secret ?? "";
        setFeishuAppId(loadedFeishuAppId);
        setFeishuAppSecret(loadedFeishuAppSecret);
        setFeishuEnabled(Boolean(loadedFeishuAppId || loadedFeishuAppSecret));

        const discordBotToken = loadedSettings.channels?.discord?.bot_token ?? "";
        setDiscordToken(discordBotToken);
        setDiscordEnabled(Boolean(discordBotToken));

        const wechatConfig = loadedSettings.channels?.["weixin-openclaw-bridge"];
        if (wechatConfig?.base_url) {
          setWechatBaseUrl(String(wechatConfig.base_url));
        }
        if (wechatConfig?.bot_token) {
          setWechatBotToken(String(wechatConfig.bot_token));
          setWechatQrStatus("connected");
          setWechatQrMessage("WeChat is already connected.");
          setWechatEnabled(true);
        }
        if (wechatConfig?.account_id) {
          setWechatAccountId(String(wechatConfig.account_id));
          setWechatEnabled(true);
        }
        if (wechatConfig?.base_url && !wechatConfig?.bot_token && !wechatConfig?.account_id) {
          setWechatEnabled(true);
        }

        const provider = loadedSettings.tunnel?.provider;
        if (provider === "cloudflare" || provider === "ngrok" || provider === "localtunnel") {
          setTunnelProvider(provider);
        }
        if (loadedSettings.tunnel?.ngrok?.auth_token) {
          setNgrokToken(loadedSettings.tunnel.ngrok.auth_token);
        }
        if (loadedSettings.tunnel?.ngrok?.domain) {
          setNgrokDomain(loadedSettings.tunnel.ngrok.domain);
        }
        if (loadedSettings.tunnel?.cloudflare?.tunnel_token) {
          setCfToken(loadedSettings.tunnel.cloudflare.tunnel_token);
        }
        if (loadedSettings.tunnel?.cloudflare?.hostname) {
          setCfHostname(loadedSettings.tunnel.cloudflare.hostname);
        }

        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const waitForWechatConfirmation = useCallback(
    async (sessionKey: string, baseUrl: string) => {
      waitingForWechatRef.current = true;

      try {
        const result = await invoke<WechatQrWaitResponse>("wechat_qr_wait", {
          request: {
            baseUrl,
            sessionKey,
            timeoutMs: 480000,
          },
        });

        if (result.connected && result.botToken) {
          setWechatBotToken(result.botToken);
          setWechatAccountId(result.accountId ?? "");
          if (result.baseUrl) setWechatBaseUrl(result.baseUrl);
          setWechatQrStatus("connected");
          setWechatQrCodeUrl("");
          setWechatQrSessionKey("");
          setWechatQrMessage(result.message || "WeChat connected successfully.");
          waitingForWechatRef.current = false;
        } else {
          resetWechatQrState(
            result.message || "WeChat login was not confirmed."
          );
        }
      } catch (error) {
        resetWechatQrState(
          error instanceof Error ? error.message : String(error)
        );
      }
    },
    [resetWechatQrState]
  );

  const startWechatQrLogin = useCallback(async () => {
    setWechatQrStatus("generating");
    setWechatQrMessage("Generating QR code…");
    setWechatQrCodeUrl("");
    setWechatQrSessionKey("");

    try {
      const baseUrl = wechatBaseUrl.trim() || DEFAULT_WECHAT_BASE_URL;
      const result = await invoke<WechatQrStartResponse>("wechat_qr_start", {
        request: {
          baseUrl,
        },
      });

      if (!result.qrcodeUrl) {
        resetWechatQrState(result.message || "Failed to generate QR code.");
        return;
      }

      setWechatQrCodeUrl(result.qrcodeUrl);
      setWechatQrSessionKey(result.sessionKey);
      setWechatQrStatus("waiting");
      setWechatQrMessage(result.message || "Scan the QR code with WeChat.");
      void waitForWechatConfirmation(result.sessionKey, baseUrl);
    } catch (error) {
      resetWechatQrState(
        error instanceof Error ? error.message : String(error)
      );
    }
  }, [resetWechatQrState, waitForWechatConfirmation, wechatBaseUrl]);

  useEffect(() => {
    const currentStep = STEPS[step] as OnboardingStep;
    if (currentStep !== "Channels") {
      if (wechatQrSessionKey || waitingForWechatRef.current) {
        void cancelWechatSession({ nextMessage: "" });
      }
    }
  }, [cancelWechatSession, step, wechatQrSessionKey]);

  useEffect(() => {
    if (!wechatEnabled && (wechatQrSessionKey || waitingForWechatRef.current)) {
      void cancelWechatSession({ nextMessage: "" });
    }
  }, [cancelWechatSession, wechatEnabled, wechatQrSessionKey]);

  useEffect(() => {
    return () => {
      if (wechatQrSessionKey || waitingForWechatRef.current) {
        void invoke("wechat_qr_cancel", {
          request: {
            keepCredentials: true,
          },
        }).catch(() => undefined);
      }
    };
  }, [wechatQrSessionKey]);

  const buildSettings = useCallback((): Settings => {
    const result: Settings = {
      ...settings,
      enabled_agents: Array.from(enabledAgents),
      default_agent: defaultAgent,
    };

    const channels: Settings["channels"] = {};

    if (telegramEnabled && tgToken.trim()) {
      channels.telegram = {
        bot_token: tgToken.trim(),
        verbose: settings.channels?.telegram?.verbose ?? {
          show_thinking: false,
          show_tool_use: false,
        },
      };
    }

    if (feishuEnabled && feishuAppId.trim() && feishuAppSecret.trim()) {
      channels.feishu = {
        app_id: feishuAppId.trim(),
        app_secret: feishuAppSecret.trim(),
        verbose: settings.channels?.feishu?.verbose ?? {
          show_thinking: false,
          show_tool_use: false,
        },
      };
    }

    if (discordEnabled && discordToken.trim()) {
      channels.discord = {
        bot_token: discordToken.trim(),
        verbose: settings.channels?.discord?.verbose ?? {
          show_thinking: false,
          show_tool_use: false,
        },
      };
    }

    if (wechatEnabled) {
      channels["weixin-openclaw-bridge"] = {
        bot_token: wechatBotToken.trim() || undefined,
        account_id: wechatAccountId.trim() || undefined,
        verbose: settings.channels?.["weixin-openclaw-bridge"]?.verbose ?? {
          show_thinking: false,
          show_tool_use: false,
        },
      };
    }

    if (Object.keys(channels).length > 0) {
      result.channels = channels;
    } else {
      delete result.channels;
    }

    if (tunnelProvider !== "none") {
      const tunnel: Settings["tunnel"] = { provider: tunnelProvider };
      // localtunnel has no config fields
      if (tunnelProvider === "ngrok") {
        tunnel.ngrok = {};
        if (ngrokToken.trim()) tunnel.ngrok.auth_token = ngrokToken.trim();
        if (ngrokDomain.trim()) tunnel.ngrok.domain = ngrokDomain.trim();
      }
      if (tunnelProvider === "cloudflare") {
        tunnel.cloudflare = {};
        if (cfToken.trim()) tunnel.cloudflare.tunnel_token = cfToken.trim();
        if (cfHostname.trim()) tunnel.cloudflare.hostname = cfHostname.trim();
      }
      result.tunnel = tunnel;
    } else {
      delete result.tunnel;
    }

    return result;
  }, [
    settings,
    enabledAgents,
    defaultAgent,
    telegramEnabled,
    tgToken,
    feishuEnabled,
    feishuAppId,
    feishuAppSecret,
    discordEnabled,
    discordToken,
    wechatEnabled,
    wechatBaseUrl,
    wechatBotToken,
    wechatAccountId,
    tunnelProvider,
    ngrokToken,
    ngrokDomain,
    cfToken,
    cfHostname,
  ]);

  const handleFinish = async () => {
    setFinishing(true);
    try {
      const finalSettings = buildSettings();
      await invoke("finish_onboarding", { settings: finalSettings });
      window.location.replace("/");
    } catch (error) {
      console.error("finish_onboarding failed:", error);
      setFinishing(false);
    }
  };

  const toggleAgent = (id: AgentId) => {
    setEnabledAgents((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      if (!next.has(defaultAgent)) {
        setDefaultAgent(Array.from(next)[0]);
      }
      return next;
    });
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-sm text-muted-foreground animate-pulse">
          Loading…
        </span>
      </div>
    );
  }

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const canNext = currentStep !== "Agents" || enabledAgents.size > 0;
  const hasTelegram = telegramEnabled && Boolean(tgToken.trim());
  const hasFeishu =
    feishuEnabled && Boolean(feishuAppId.trim() && feishuAppSecret.trim());
  const hasDiscord = discordEnabled && Boolean(discordToken.trim());
  const hasWechat = wechatEnabled && Boolean(wechatBotToken.trim());

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-1 px-6 pt-5 pb-2">
        {STEPS.map((label, index) => (
          <div key={label} className="flex items-center gap-1 flex-1">
            <div
              className={`h-1 flex-1 rounded-full transition-colors ${
                index <= step ? "bg-primary" : "bg-border"
              }`}
            />
          </div>
        ))}
      </div>
      <div className="px-6 pb-3">
        <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
          Step {step + 1} of {STEPS.length} — {currentStep}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {currentStep === "Welcome" && <StepWelcome />}
        {currentStep === "Agents" && (
          <StepAgents
            enabled={enabledAgents}
            defaultAgent={defaultAgent}
            onToggle={toggleAgent}
            onSetDefault={setDefaultAgent}
          />
        )}
        {currentStep === "Channels" && (
          <StepChannels
            discoveredPlugins={discoveredPlugins}
            telegramEnabled={telegramEnabled}
            onTelegramEnabledChange={setTelegramEnabled}
            tgToken={tgToken}
            onTgToken={setTgToken}
            feishuEnabled={feishuEnabled}
            onFeishuEnabledChange={setFeishuEnabled}
            feishuAppId={feishuAppId}
            onFeishuAppId={setFeishuAppId}
            feishuAppSecret={feishuAppSecret}
            onFeishuAppSecret={setFeishuAppSecret}
            discordEnabled={discordEnabled}
            onDiscordEnabledChange={setDiscordEnabled}
            discordToken={discordToken}
            onDiscordToken={setDiscordToken}
            wechatEnabled={wechatEnabled}
            onWechatEnabledChange={setWechatEnabled}
            wechatQrStatus={wechatQrStatus}
            wechatQrCodeUrl={wechatQrCodeUrl}
            wechatQrMessage={wechatQrMessage}
            wechatAccountId={wechatAccountId}
            wechatBotToken={wechatBotToken}
            wechatQrSessionKey={wechatQrSessionKey}
            onStartWechatQrLogin={startWechatQrLogin}
            onCancelWechatQrLogin={() => {
              void cancelWechatSession({ nextMessage: "WeChat login cancelled." });
            }}
          />
        )}
        {currentStep === "Tunnel" && (
          <StepTunnel
            provider={tunnelProvider}
            onProvider={setTunnelProvider}
            ngrokToken={ngrokToken}
            onNgrokToken={setNgrokToken}
            ngrokDomain={ngrokDomain}
            onNgrokDomain={setNgrokDomain}
            cfToken={cfToken}
            onCfToken={setCfToken}
            cfHostname={cfHostname}
            onCfHostname={setCfHostname}
          />
        )}
        {currentStep === "Confirm" && (
          <StepConfirm
            enabledAgents={enabledAgents}
            defaultAgent={defaultAgent}
            tunnelProvider={tunnelProvider}
            hasTelegram={hasTelegram}
            hasFeishu={hasFeishu}
            hasDiscord={hasDiscord}
            hasWechat={hasWechat}
          />
        )}
      </div>

      <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
        <button
          onClick={() => setStep((value) => Math.max(0, value - 1))}
          disabled={step === 0}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        {isLast ? (
          <button
            onClick={handleFinish}
            disabled={finishing}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {finishing ? (
              <>Launching…</>
            ) : (
              <>
                <Rocket className="w-4 h-4" />
                Launch VibeAround
              </>
            )}
          </button>
        ) : (
          <button
            onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}
            disabled={!canNext}
            className="flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {currentStep === "Welcome" ? "Get Started" : "Next"}
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
