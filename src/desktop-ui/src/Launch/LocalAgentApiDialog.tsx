import { Server } from "lucide-react";
import { useI18n } from "@va/i18n";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LocalAgentApiPanel } from "./LocalAgentApiPanel";
import type { LocalAgentApiTarget } from "./localAgentApi";

interface LocalAgentApiDialogProps {
  target: LocalAgentApiTarget | null;
  onClose: () => void;
}

export function LocalAgentApiDialog({
  target,
  onClose,
}: LocalAgentApiDialogProps) {
  const { t } = useI18n();

  if (!target) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="!flex max-h-[calc(100vh-64px)] w-[min(860px,calc(100vw-32px))] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(860px,calc(100vw-32px))]"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="shrink-0 px-6 pb-4 pt-6 pr-12">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Server className="h-4 w-4 text-primary" />
            {t("Local API")}
          </DialogTitle>
          <DialogDescription className="mt-2 truncate text-sm">
            {target.agentLabel} · {target.profileLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 [scrollbar-gutter:stable]">
          <LocalAgentApiPanel target={target} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
