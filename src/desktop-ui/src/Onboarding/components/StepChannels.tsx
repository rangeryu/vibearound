import React, { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

// DEFAULT_WECHAT_BASE_URL is used internally but not exposed in the UI
import type { StepChannelsProps } from "../types";

export function StepChannels({
  discoveredPlugins,
  telegramEnabled,
  onTelegramEnabledChange,
  tgToken,
  onTgToken,
  feishuEnabled,
  onFeishuEnabledChange,
  feishuAppId,
  onFeishuAppId,
  feishuAppSecret,
  onFeishuAppSecret,
  discordEnabled,
  onDiscordEnabledChange,
  discordToken,
  onDiscordToken,
  wechatEnabled,
  onWechatEnabledChange,
  wechatQrStatus,
  wechatQrCodeUrl,
  wechatQrMessage,
  wechatAccountId,
  wechatBotToken,
  wechatQrSessionKey,
  onStartWechatQrLogin,
  onCancelWechatQrLogin,
}: StepChannelsProps) {
  const isWechatBusy =
    wechatQrStatus === "generating" || wechatQrStatus === "waiting";
  const wechatCardRef = useRef<HTMLElement | null>(null);
  const wechatQrRef = useRef<HTMLDivElement | null>(null);
  const discoveredNames = discoveredPlugins.map((plugin) => plugin.name).join(", ");
  const wechatPlugin = discoveredPlugins.find(
    (plugin) => plugin.id === "weixin-openclaw-bridge"
  );

  useEffect(() => {
    if (!wechatEnabled) return;
    wechatCardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [wechatEnabled]);

  useEffect(() => {
    if (!wechatQrCodeUrl) return;
    wechatQrRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [wechatQrCodeUrl]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          IM Channels
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Connect messaging bots to vibe code from your phone. You can skip this
          and configure later.
        </p>
        <p className="text-[11px] text-muted-foreground mt-2">
          Discovered channel plugins: {discoveredNames || "None"}
        </p>
      </div>

      <ChannelCard
        title="Telegram"
        description="Use a BotFather token to chat with VibeAround in Telegram."
        enabled={telegramEnabled}
        onEnabledChange={onTelegramEnabledChange}
      >
        <label className="block">
          <span className="text-xs text-muted-foreground">Bot Token</span>
          <input
            type="password"
            value={tgToken}
            onChange={(event) => onTgToken(event.target.value)}
            placeholder="123456:ABC-DEF…"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
          />
        </label>
      </ChannelCard>

      <ChannelCard
        title="Feishu (Lark)"
        description="Provide the app credentials for your Feishu bot integration."
        enabled={feishuEnabled}
        onEnabledChange={onFeishuEnabledChange}
      >
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs text-muted-foreground">App ID</span>
            <input
              type="text"
              value={feishuAppId}
              onChange={(event) => onFeishuAppId(event.target.value)}
              placeholder="cli_xxxx"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">App Secret</span>
            <input
              type="password"
              value={feishuAppSecret}
              onChange={(event) => onFeishuAppSecret(event.target.value)}
              placeholder="xxxxxxxx"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
            />
          </label>
        </div>
      </ChannelCard>

      <ChannelCard
        title="Discord"
        description="Use a Discord bot token to chat with VibeAround via @mention or DM."
        enabled={discordEnabled}
        onEnabledChange={onDiscordEnabledChange}
      >
        <label className="block">
          <span className="text-xs text-muted-foreground">Bot Token</span>
          <input
            type="password"
            value={discordToken}
            onChange={(event) => onDiscordToken(event.target.value)}
            placeholder="Paste your Discord bot token"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
          />
        </label>
      </ChannelCard>

      <ChannelCard
        ref={wechatCardRef}
        title="WeChat"
        description="Use QR authorization and keep the login session alive while you stay in this step."
        enabled={wechatEnabled}
        onEnabledChange={onWechatEnabledChange}
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-border p-3 space-y-3 bg-muted/20">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">QR Login</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Generate a QR code, scan it with WeChat, then wait for the
                  authorization to complete.
                </div>
                {wechatPlugin?.supportsQrcodeLogin ? (
                  <div className="text-[11px] text-primary mt-1">
                    This plugin advertises QR code login support.
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {(wechatQrSessionKey || isWechatBusy) && (
                  <button
                    onClick={onCancelWechatQrLogin}
                    className="px-3 py-2 rounded-md border border-border text-xs font-medium hover:bg-accent transition-colors"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={onStartWechatQrLogin}
                  disabled={isWechatBusy}
                  className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {wechatQrStatus === "connected"
                    ? "Reconnect"
                    : isWechatBusy
                      ? "Waiting…"
                      : "Connect WeChat"}
                </button>
              </div>
            </div>

            {wechatQrMessage ? (
              <div
                className={`text-xs rounded-md px-3 py-2 ${
                  wechatQrStatus === "error"
                    ? "bg-destructive/10 text-destructive"
                    : wechatQrStatus === "connected"
                      ? "bg-primary/10 text-primary"
                      : "bg-background text-muted-foreground"
                }`}
              >
                {wechatQrMessage}
              </div>
            ) : null}

            {wechatQrCodeUrl ? (
              <div
                ref={wechatQrRef}
                className="flex flex-col items-center gap-2 pt-1 scroll-mt-6"
              >
                <div className="rounded-lg border bg-white p-3 shadow-sm">
                  <QRCodeSVG
                    value={wechatQrCodeUrl}
                    size={176}
                    bgColor="#ffffff"
                    fgColor="#111111"
                    level="M"
                    includeMargin
                    title="WeChat QR code"
                  />
                </div>
                <div className="text-[11px] text-muted-foreground text-center">
                  Scan with WeChat and confirm on your phone.
                </div>
              </div>
            ) : null}

            {wechatQrSessionKey ? (
              <div className="text-[11px] text-muted-foreground break-all">
                Session: {wechatQrSessionKey}
              </div>
            ) : null}

            {wechatBotToken ? (
              <div className="text-[11px] text-muted-foreground break-all">
                Connected account: {wechatAccountId || "Authorized"}
              </div>
            ) : null}
          </div>
        </div>
      </ChannelCard>
    </div>
  );
}

const ChannelCard = React.forwardRef<HTMLElement, {
  title: string;
  description: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  children: React.ReactNode;
}>(function ChannelCard({
  title,
  description,
  enabled,
  onEnabledChange,
  children,
}, ref) {
  return (
    <section
      ref={ref}
      className="rounded-xl border border-border bg-card overflow-hidden scroll-mt-4"
    >
      <div className="flex items-start justify-between gap-4 px-4 py-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground max-w-xl">{description}</div>
        </div>
        <button
          type="button"
          onClick={() => onEnabledChange(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
            enabled
              ? "border-primary bg-primary"
              : "border-border bg-muted"
          }`}
          aria-pressed={enabled}
          aria-label={`Toggle ${title}`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      {enabled ? <div className="border-t border-border px-4 py-4">{children}</div> : null}
    </section>
  );
});
