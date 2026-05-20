import { Bot, MessageCircle, RadioTower } from "lucide-react";
import { useI18n } from "@va/i18n";

import { Checkbox } from "@/components/ui/checkbox";

import type { OnboardingGoal } from "../constants";

interface StepWelcomeProps {
  selectedGoals: Set<OnboardingGoal>;
  onToggleGoal: (goal: OnboardingGoal) => void;
}

const GOAL_CARDS: Array<{
  id: OnboardingGoal;
  title: string;
  details: string[];
  icon: typeof Bot;
}> = [
  {
    id: "agents",
    title: "Coding agent launch",
    icon: Bot,
    details: [
      "Launch Claude, Codex, and other CLIs quickly",
      "Use multiple provider profiles",
      "Route clients through the local API bridge",
    ],
  },
  {
    id: "channels",
    title: "IM integration",
    icon: MessageCircle,
    details: [
      "Connect messaging platforms and bot plugins",
      "Start and continue coding sessions from your phone",
      "Use QR login and plugin-specific settings",
    ],
  },
  {
    id: "tunnel",
    title: "Tunnel",
    icon: RadioTower,
    details: [
      "Expose local webhooks and remote access when needed",
      "Use Cloudflare, ngrok, or localtunnel",
      "Skip this when you only work locally",
    ],
  },
];

export function StepWelcome({
  selectedGoals,
  onToggleGoal,
}: StepWelcomeProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-5">
      <div className="max-w-3xl">
        <h2 className="text-lg font-semibold">{t("How will you use VibeAround?")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t(
            "Choose what you want to set up now. You can change this later at any time, so skip anything you're unsure about.",
          )}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {GOAL_CARDS.map((card) => {
          const Icon = card.icon;
          const checked = selectedGoals.has(card.id);

          return (
            <div
              key={card.id}
              role="checkbox"
              aria-checked={checked}
              tabIndex={0}
              className={`group relative flex min-h-[230px] cursor-pointer flex-col gap-5 rounded-md border p-5 pr-12 text-left shadow-xs transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                checked
                  ? "border-primary/60 bg-primary/5 shadow-primary/10"
                  : "border-border bg-card hover:border-primary/35 hover:bg-accent/25"
              }`}
              onClick={() => onToggleGoal(card.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggleGoal(card.id);
                }
              }}
            >
              <Checkbox
                checked={checked}
                aria-hidden="true"
                tabIndex={-1}
                className="pointer-events-none absolute right-5 top-5 h-5 w-5 transition-transform duration-200 group-hover:scale-105"
              />
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors duration-200 ${
                  checked
                    ? "bg-primary text-primary-foreground"
                    : "bg-primary/10 text-primary group-hover:bg-primary/15"
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[15px] font-semibold leading-tight">{t(card.title)}</div>
                <ul className="mt-4 space-y-2.5 text-[13px] leading-relaxed text-muted-foreground">
                  {card.details.map((detail) => (
                    <li key={detail} className="flex gap-2">
                      <span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/55" />
                      <span>{t(detail)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
