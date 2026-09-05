import { useSyncExternalStore } from "react";
import english from "../locales/en.json";

const LOCALE_STORAGE_KEY = "tranquil-pds-locale";

export const supportedLocales = [
  "en",
  "zh",
  "ja",
  "ko",
  "sv",
  "fi",
  "fr",
] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
type TranslationValues = Record<string, string | number>;
type Messages = Record<string, unknown>;

export const localeNames: Record<SupportedLocale, string> = {
  en: "English",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
  sv: "Svenska",
  fi: "Suomi",
  fr: "Français",
};

const localeLoaders: Record<
  SupportedLocale,
  () => Promise<{ default: Messages }>
> = {
  en: async () => ({ default: english }),
  zh: () => import("../locales/zh.json"),
  ja: () => import("../locales/ja.json"),
  ko: () => import("../locales/ko.json"),
  sv: () => import("../locales/sv.json"),
  fi: () => import("../locales/fi.json"),
  fr: () => import("../locales/fr.json"),
};

let activeLocale: SupportedLocale = "en";
let activeMessages: Messages = english;
let revision = 0;
const listeners = new Set<() => void>();

function isSupportedLocale(
  locale: string | null | undefined,
): locale is SupportedLocale {
  return supportedLocales.includes(locale as SupportedLocale);
}

function messageAt(messages: Messages, key: string): string | undefined {
  let value: unknown = messages;
  for (const segment of key.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === "string" ? value : undefined;
}

function interpolate(message: string, values?: TranslationValues): string {
  if (!values) return message;
  return message.replace(/\{\{?\s*([^}\s]+)\s*\}\}?/g, (_, key: string) =>
    String(values[key] ?? ""),
  );
}

function notifyLocaleChanged(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

async function loadLocale(locale: SupportedLocale): Promise<void> {
  try {
    const messages = (await localeLoaders[locale]()).default;
    if (locale !== activeLocale) return;
    activeMessages = messages;
  } catch {
    if (locale !== activeLocale) return;
    activeMessages = english;
  }
  notifyLocaleChanged();
}

export function getInitialLocale(): SupportedLocale {
  const storedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isSupportedLocale(storedLocale)) return storedLocale;

  const browserLocale = navigator.language.split("-")[0];
  return isSupportedLocale(browserLocale) ? browserLocale : "en";
}

export async function initializeI18n(): Promise<void> {
  activeLocale = getInitialLocale();
  document.documentElement.lang = activeLocale;
  await loadLocale(activeLocale);
}

export function setLocale(locale: SupportedLocale): void {
  activeLocale = locale;
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  activeMessages = locale === "en" ? english : {};
  notifyLocaleChanged();
  void loadLocale(locale);
}

export function translate(key: string, values?: TranslationValues): string {
  const message =
    messageAt(activeMessages, key) ?? messageAt(english, key) ?? key;
  return interpolate(message, values);
}

export function useTranslation(): (
  key: string,
  values?: TranslationValues,
) => string {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => revision,
    () => revision,
  );
  return translate;
}
