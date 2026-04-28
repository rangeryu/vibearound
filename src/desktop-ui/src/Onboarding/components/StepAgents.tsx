import { Bot, Check, FolderOpen, Plus, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentSummary, StepAgentsProps } from "../types";

const RECOMMENDED_AGENT_IDS = new Set(["claude", "codex"]);
const NO_HANDOVER_AGENTS = new Set(["opencode"]);
const DIRECT_VALUE = "__direct__";

export function StepAgents({
  agents,
  profiles,
  enabled,
  defaultAgent,
  defaultProfiles,
  onToggle,
  onSetDefault,
  onSetDefaultProfile,
  onCreateProfile,
}: StepAgentsProps) {
  const recommended = agents.filter((agent) => RECOMMENDED_AGENT_IDS.has(agent.id));
  const others = agents.filter((agent) => !RECOMMENDED_AGENT_IDS.has(agent.id));
  const compatibleProfiles = profiles.filter((profile) =>
    profile.launchTargets.some((target) => target.id === defaultAgent),
  );
  const selectedProfile = defaultProfiles[defaultAgent] ?? DIRECT_VALUE;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          Quick Launch
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Pick the CLI VibeAround should start from Launch and IM messages.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-3 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Star className="w-3.5 h-3.5 text-primary" />
          Best recommended
        </div>
        <AgentGrid
          agents={recommended}
          enabled={enabled}
          defaultAgent={defaultAgent}
          onToggle={onToggle}
          onSetDefault={onSetDefault}
        />
      </section>

      {others.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-3 space-y-3">
          <div className="text-xs font-medium text-muted-foreground">Other CLIs</div>
          <AgentGrid
            agents={others}
            enabled={enabled}
            defaultAgent={defaultAgent}
            onToggle={onToggle}
            onSetDefault={onSetDefault}
          />
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium">Default API profile</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Optional. Direct launch uses the CLI's existing login.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onCreateProfile}>
            <Plus className="w-3.5 h-3.5" />
            Add API profile
          </Button>
        </div>

        <Select
          value={selectedProfile}
          onValueChange={(value) =>
            onSetDefaultProfile(defaultAgent, value === DIRECT_VALUE ? null : value)
          }
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="Direct launch" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DIRECT_VALUE}>Direct launch</SelectItem>
            {compatibleProfiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {compatibleProfiles.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No saved profile supports {defaultAgent} yet.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-primary" />
          <div>
            <div className="text-xs font-medium">Default workspace</div>
            <div className="text-[11px] text-muted-foreground font-mono">
              ~/.vibearound/workspaces
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function AgentGrid({
  agents,
  enabled,
  defaultAgent,
  onToggle,
  onSetDefault,
}: {
  agents: AgentSummary[];
  enabled: Set<string>;
  defaultAgent: string;
  onToggle: (id: string) => void;
  onSetDefault: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {agents.map((agent) => {
        const isEnabled = enabled.has(agent.id);
        const isDefault = defaultAgent === agent.id;
        const noHandover = NO_HANDOVER_AGENTS.has(agent.id);
        return (
          <div
            key={agent.id}
            className={`relative flex flex-col gap-1.5 p-3 rounded-lg border cursor-pointer transition-colors ${
              isEnabled
                ? "border-primary/40 bg-primary/5"
                : "border-border hover:border-border/80"
            }`}
            onClick={() => onToggle(agent.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`text-sm font-medium flex items-center gap-1.5 min-w-0 ${
                  isEnabled ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className="truncate">{agent.display_name}</span>
                {noHandover && (
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-muted text-muted-foreground/60 leading-none shrink-0">
                    no handover
                  </span>
                )}
              </span>
              <div
                className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${
                  isEnabled ? "bg-primary border-primary" : "border-muted-foreground/30"
                }`}
              >
                {isEnabled && <Check className="w-3 h-3 text-primary-foreground" />}
              </div>
            </div>
            {isEnabled && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSetDefault(agent.id);
                }}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded self-start transition-colors ${
                  isDefault
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {isDefault ? "default" : "set default"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
