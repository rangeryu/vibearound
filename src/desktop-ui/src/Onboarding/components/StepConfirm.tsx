import { Rocket } from "lucide-react";

import { AGENT_LABELS, TUNNEL_LABELS } from "../constants";
import type { StepConfirmProps } from "../types";

export function StepConfirm({
  enabledAgents,
  defaultAgent,
  tunnelProvider,
  hasTelegram,
  hasFeishu,
  hasWechat,
}: StepConfirmProps) {
  const agents = Array.from(enabledAgents)
    .map((id) => `${AGENT_LABELS[id]}${id === defaultAgent ? " ★" : ""}`)
    .join(", ");

  const channels: string[] = [];
  if (hasTelegram) channels.push("Telegram");
  if (hasFeishu) channels.push("Feishu");
  if (hasWechat) channels.push("WeChat");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Rocket className="w-4 h-4 text-primary" />
          Ready to Launch
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Review your configuration. You can always change these in
          settings.json later.
        </p>
      </div>

      <div className="space-y-2 text-sm">
        <SummaryRow label="Agents" value={agents} />
        <SummaryRow
          label="Channels"
          value={channels.length > 0 ? channels.join(", ") : "None configured"}
        />
        <SummaryRow label="Tunnel" value={TUNNEL_LABELS[tunnelProvider]} />
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2 px-3 rounded-md bg-muted/40">
      <span className="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
