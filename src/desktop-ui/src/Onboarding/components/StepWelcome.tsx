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
    title: "Coding agent 启动",
    icon: Bot,
    details: [
      "快速启动 Claude、Codex 等 CLI",
      "支持多个 provider profile",
      "支持本地 API proxy",
    ],
  },
  {
    id: "channels",
    title: "IM 对接",
    icon: MessageCircle,
    details: [
      "连接消息平台和 bot 插件",
      "从手机触发和接管 coding session",
      "支持扫码登录和插件配置",
    ],
  },
  {
    id: "tunnel",
    title: "Tunnel",
    icon: RadioTower,
    details: [
      "把本地服务暴露给 webhook 和远程设备",
      "支持 Cloudflare、ngrok、localtunnel",
      "只在本机使用时可以跳过",
    ],
  },
];

export function StepWelcome({
  selectedGoals,
  onToggleGoal,
}: StepWelcomeProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t("你的目标是：")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("选择你这次要配置的部分，后面的 onboarding 只会显示选中的流程。")}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {GOAL_CARDS.map((card) => {
          const Icon = card.icon;
          const checked = selectedGoals.has(card.id);

          return (
            <div
              key={card.id}
              role="checkbox"
              aria-checked={checked}
              tabIndex={0}
              className={`relative flex min-h-[178px] cursor-pointer flex-col gap-3 rounded-md border p-3 pr-9 text-left transition-colors ${
                checked
                  ? "border-primary/45 bg-primary/5"
                  : "border-border bg-background hover:border-border/80"
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
                className="pointer-events-none absolute right-3 top-3"
              />
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">{t(card.title)}</div>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  {card.details.map((detail) => (
                    <li key={detail} className="flex gap-1.5">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
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
