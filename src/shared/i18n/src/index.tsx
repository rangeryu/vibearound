import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { zhCN } from "./locales/zh-CN";

export const LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

const STORAGE_KEY = "vibearound.locale";

type Params = Record<string, string | number | null | undefined>;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Params) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale());

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const t = useCallback(
    (key: string, params?: Params) => translate(locale, key, params),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}

export function translate(
  locale: Locale,
  key: string,
  params?: Params,
): string {
  const template = locale === "zh-CN" ? (zhCN[key] ?? key) : key;
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value == null ? "" : String(value);
  });
}

function initialLocale(): Locale {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;

    const languages = window.navigator.languages?.length
      ? window.navigator.languages
      : [window.navigator.language];
    for (const language of languages) {
      const normalized = normalizeLocale(language);
      if (normalized) return normalized;
    }
  }
  return "en";
}

function normalizeLocale(value: string | undefined): Locale | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === "zh-cn" || lower === "zh-hans" || lower.startsWith("zh-cn")) {
    return "zh-CN";
  }
  if (lower.startsWith("zh")) return "zh-CN";
  if (lower.startsWith("en")) return "en";
  return null;
}

function isLocale(value: string | null): value is Locale {
  return value === "en" || value === "zh-CN";
}
