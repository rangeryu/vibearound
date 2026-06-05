import {
  Cloud,
  Gamepad2,
  Hash,
  MessageCircle,
  MessagesSquare,
  Navigation,
  RadioTower,
  Send,
  Waypoints,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { BrandIcon } from "@/components/brand-icon";
import { cn } from "@/lib/utils";
import { toneDot } from "./primitives";
import type { Tone } from "./types";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface ServiceIconMeta {
  Icon: IconComponent;
  className: string;
}

const CHANNEL_ICONS: Record<string, ServiceIconMeta> = {
  dingtalk: { Icon: RadioTower, className: "bg-[#1677ff]/10 text-[#1677ff]" },
  discord: { Icon: Gamepad2, className: "bg-[#5865f2]/10 text-[#5865f2]" },
  feishu: { Icon: MessagesSquare, className: "bg-[#00b96b]/10 text-[#00a870]" },
  slack: { Icon: Hash, className: "bg-[#611f69]/10 text-[#611f69]" },
  telegram: { Icon: Send, className: "bg-[#229ed9]/10 text-[#229ed9]" },
  wechat: { Icon: MessageCircle, className: "bg-[#07c160]/10 text-[#07a84f]" },
  wecom: { Icon: MessagesSquare, className: "bg-[#2f7dff]/10 text-[#2f7dff]" },
};

const TUNNEL_ICONS: Record<string, ServiceIconMeta> = {
  cloudflare: { Icon: Cloud, className: "bg-[#f6821f]/10 text-[#f6821f]" },
  localtunnel: { Icon: Navigation, className: "bg-primary/10 text-primary" },
  ngrok: { Icon: Waypoints, className: "bg-[#1f1f1f]/10 text-[#1f1f1f]" },
};

export function ServiceIconBadge({
  id,
  kind,
  label,
  status,
  tone,
}: {
  id: string;
  kind: "channel" | "tunnel";
  label: string;
  status: string;
  tone: Tone;
}) {
  const meta =
    kind === "channel"
      ? CHANNEL_ICONS[id] ?? { Icon: MessageCircle, className: "bg-primary/10 text-primary" }
      : TUNNEL_ICONS[id] ?? { Icon: Cloud, className: "bg-primary/10 text-primary" };
  const { Icon } = meta;

  return (
    <span
      className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card"
      title={`${label}: ${status}`}
    >
      <span
        className={cn(
          "flex h-full w-full items-center justify-center rounded-[inherit]",
          meta.className,
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span
        className={cn(
          "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
          toneDot(tone),
        )}
      />
    </span>
  );
}

export function AgentIconBadge({
  cliKind,
  label,
  status,
  tone,
}: {
  cliKind: string | null;
  label: string;
  status: string;
  tone: Tone;
}) {
  const id = cliKind?.toLowerCase() ?? "agent";

  return (
    <span className="relative inline-flex h-7 w-7 shrink-0" title={`${label}: ${status}`}>
      <BrandIcon
        kind="cli"
        id={id}
        label={label}
        framed
        className="h-7 w-7"
      />
      <span
        className={cn(
          "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
          toneDot(tone),
        )}
      />
    </span>
  );
}
