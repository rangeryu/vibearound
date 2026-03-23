import { Sparkles } from "lucide-react";

export function StepWelcome() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
      <Sparkles className="w-10 h-10 text-primary" />
      <h2 className="text-xl font-semibold">Welcome to VibeAround</h2>
      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
        Let&apos;s set things up so you can vibe code from anywhere. This will only
        take a minute — configure your agents, messaging channels, and tunnel.
      </p>
    </div>
  );
}
