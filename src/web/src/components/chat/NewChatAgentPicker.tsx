"use client";

import { Bot, Check } from "lucide-react";
import type { AgentInfo, ProfileLaunchOption } from "@va/client";
import { useI18n } from "@va/i18n";

import { agentIdToToolType } from "@/lib/agents";
import { cn } from "@/lib/utils";

const DIRECT_PROFILE_ID = "direct";

interface NewChatAgentPickerProps {
  agents: AgentInfo[];
  profiles: ProfileLaunchOption[];
  selectedAgentId: string;
  selectedProfileId?: string;
  fallbackAgentLabel: string;
  onLaunchChange: (agentId: string, profileId?: string) => void;
}

function launchProfilesForAgent(profiles: ProfileLaunchOption[], agentId: string) {
  return profiles.flatMap((profile) => {
    const target = profile.launch_targets.find((target) => target.id === agentId);
    return target ? [{ profile, usesProxy: Boolean(target.proxy_target_api_type) }] : [];
  });
}

function agentAccentClass(agentId: string) {
  switch (agentIdToToolType(agentId)) {
    case "claude":
      return "text-orange-500";
    case "codex":
      return "text-emerald-500";
    case "gemini":
      return "text-blue-500";
    default:
      return "text-primary";
  }
}

export function NewChatAgentPicker({
  agents,
  profiles,
  selectedAgentId,
  selectedProfileId,
  fallbackAgentLabel,
  onLaunchChange,
}: NewChatAgentPickerProps) {
  const { t } = useI18n();
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const selectedAgentName = selectedAgent?.name ?? fallbackAgentLabel;
  const selectedAgentProfiles = launchProfilesForAgent(profiles, selectedAgentId);

  const chooseAgent = (agent: AgentInfo) => {
    const nextAgentProfiles = launchProfilesForAgent(profiles, agent.id);
    const nextProfileId =
      selectedProfileId === DIRECT_PROFILE_ID ||
      nextAgentProfiles.some(({ profile }) => profile.id === selectedProfileId)
        ? selectedProfileId
        : undefined;
    onLaunchChange(agent.id, nextProfileId);
  };

  return (
    <section className="mx-auto w-full max-w-4xl">
      <div className="mb-2 px-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
        {t("Agent")}
      </div>
      {agents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {selectedAgentName}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => {
            const selected = agent.id === selectedAgentId;
            return (
              <button
                key={agent.id}
                type="button"
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                  selected
                    ? "border-primary/50 bg-primary/5 text-foreground"
                    : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                aria-pressed={selected}
                onClick={() => chooseAgent(agent)}
              >
                <Bot className={cn("h-4 w-4 shrink-0", agentAccentClass(agent.id))} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{agent.name}</span>
                {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
        <button
          type="button"
          className={cn(
            "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
            selectedProfileId === undefined
              ? "border-primary/50 bg-primary/5 text-foreground"
              : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          aria-pressed={selectedProfileId === undefined}
          onClick={() => onLaunchChange(selectedAgentId, undefined)}
        >
          {t("Default")}
        </button>
        <button
          type="button"
          className={cn(
            "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
            selectedProfileId === DIRECT_PROFILE_ID
              ? "border-primary/50 bg-primary/5 text-foreground"
              : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          aria-pressed={selectedProfileId === DIRECT_PROFILE_ID}
          onClick={() => onLaunchChange(selectedAgentId, DIRECT_PROFILE_ID)}
        >
          {t("Direct")}
        </button>
        {selectedAgentProfiles.map(({ profile, usesProxy }) => (
          <button
            key={profile.id}
            type="button"
            className={cn(
              "max-w-full rounded-md border px-2.5 py-1.5 text-xs transition-colors",
              selectedProfileId === profile.id
                ? "border-primary/50 bg-primary/5 text-foreground"
                : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
            aria-pressed={selectedProfileId === profile.id}
            title={profile.label}
            onClick={() => onLaunchChange(selectedAgentId, profile.id)}
          >
            <span className="block truncate">
              {usesProxy ? t("{{profile}} (proxy)", { profile: profile.label }) : profile.label}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
