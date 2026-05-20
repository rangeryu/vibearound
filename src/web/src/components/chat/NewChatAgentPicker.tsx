"use client";

import type { AgentInfo, ProfileLaunchOption } from "@va/client";
import { useI18n } from "@va/i18n";

import { BrandIcon } from "@/components/brand-icon";
import { cn } from "@/lib/utils";

const DIRECT_PROFILE_ID = "direct";

interface NewChatAgentPickerProps {
  agents: AgentInfo[];
  profiles: ProfileLaunchOption[];
  selectedAgentId: string;
  selectedProfileId?: string;
  fallbackAgentLabel: string;
  onLaunchChange: (agentId: string, profileId?: string) => void;
  className?: string;
}

function launchProfilesForAgent(profiles: ProfileLaunchOption[], agentId: string) {
  return profiles.flatMap((profile) => {
    const target = profile.launch_targets.find((target) => target.id === agentId);
    return target ? [{ profile, usesProxy: Boolean(target.proxy_target_api_type) }] : [];
  });
}

export function NewChatAgentPicker({
  agents,
  profiles,
  selectedAgentId,
  selectedProfileId,
  fallbackAgentLabel,
  onLaunchChange,
  className,
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
        : DIRECT_PROFILE_ID;
    onLaunchChange(agent.id, nextProfileId);
  };

  return (
    <section className={cn("w-full", className)}>
      <div className="mb-2 px-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
        {t("Agent")}
      </div>

      <div className="rounded-lg border border-border bg-muted/10 p-2.5">
        <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)]">
          <div className="min-w-0">
            {agents.length === 0 ? (
              <div className="flex flex-wrap gap-2 md:w-10 md:flex-col">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-background/70 text-muted-foreground"
                  title={selectedAgentName}
                  aria-label={selectedAgentName}
                >
                  <BrandIcon
                    kind="cli"
                    id={selectedAgentId}
                    label={selectedAgentName}
                    className="h-5 w-5"
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 md:w-10 md:flex-col">
                {agents.map((agent) => {
                  const selected = agent.id === selectedAgentId;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      className={cn(
                        "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md border transition-colors",
                        selected
                          ? "border-primary/50 bg-primary/5 text-foreground"
                          : "border-border bg-background/70 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                      aria-pressed={selected}
                      aria-label={agent.name}
                      title={agent.name}
                      onClick={() => chooseAgent(agent)}
                    >
                      <BrandIcon kind="cli" id={agent.id} label={agent.name} className="h-5 w-5" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="min-w-0 border-t border-border/60 pt-2 md:border-l md:border-t-0 md:pl-3 md:pt-0">
            <div className="mb-2 flex min-w-0 items-center justify-between gap-2 px-1">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                {t("Profile")}
              </div>
              <div className="min-w-0 truncate text-[11px] text-muted-foreground/60">
                {selectedAgentName}
              </div>
            </div>
            <div className="mb-2 px-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
              {t("Profiles")}
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors",
                  selectedProfileId === DIRECT_PROFILE_ID
                    ? "border-primary/50 bg-primary/5 text-foreground"
                    : "border-border bg-background/70 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                aria-pressed={selectedProfileId === DIRECT_PROFILE_ID}
                onClick={() => onLaunchChange(selectedAgentId, DIRECT_PROFILE_ID)}
              >
                <BrandIcon
                  kind="cli"
                  id={selectedAgentId}
                  label={selectedAgentName}
                  className="h-4 w-4"
                />
                <span className="min-w-0 flex-1 truncate">{t("Direct")}</span>
              </button>
              {selectedAgentProfiles.map(({ profile, usesProxy }) => (
                <button
                  key={profile.id}
                  type="button"
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors",
                    selectedProfileId === profile.id
                      ? "border-primary/50 bg-primary/5 text-foreground"
                      : "border-border bg-background/70 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  aria-pressed={selectedProfileId === profile.id}
                  title={profile.label}
                  onClick={() => onLaunchChange(selectedAgentId, profile.id)}
                >
                  <BrandIcon
                    kind="provider"
                    id={profile.provider}
                    label={profile.label}
                    fallback={profile.label.slice(0, 1).toUpperCase()}
                    className="h-4 w-4"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {usesProxy
                      ? t("{{profile}} (API bridge)", { profile: profile.label })
                      : profile.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
