"use client";

import type { ReactNode } from "react";
import { useI18n } from "@va/i18n";

interface NewChatHomeProps {
  children: ReactNode;
}

export function NewChatHome({ children }: NewChatHomeProps) {
  const { t } = useI18n();

  return (
    <div className="h-full min-h-0 overflow-y-auto px-4 sm:px-8">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center py-10 sm:py-12">
        <h2 className="mb-8 text-center text-2xl font-medium tracking-normal text-foreground sm:text-3xl">
          {t("What should we build in VibeAround?")}
        </h2>
        {children}
      </div>
    </div>
  );
}
