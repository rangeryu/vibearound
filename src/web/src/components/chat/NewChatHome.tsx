"use client";

import type { ReactNode } from "react";
import { useI18n } from "@va/i18n";

interface NewChatHomeProps {
  children: ReactNode;
}

export function NewChatHome({ children }: NewChatHomeProps) {
  const { t } = useI18n();

  return (
    <div className="flex h-full min-h-0 flex-col items-center px-4 py-12 sm:px-8">
      <div className="flex w-full max-w-4xl flex-1 flex-col justify-center pb-20">
        <h2 className="mb-8 text-center text-2xl font-medium tracking-normal text-foreground sm:text-3xl">
          {t("What should we build in VibeAround?")}
        </h2>
        {children}
      </div>
    </div>
  );
}
