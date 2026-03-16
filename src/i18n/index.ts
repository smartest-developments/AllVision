import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale, type Locale } from './locales';
import { en } from './en';
import { it } from './it';

export type Messages = {
  nav: { home: string; timeline: string; admin: string; gdpr: string };
  home: { title: string; tagline: string; timelineTitle: string; timelineIntro: string };
  timeline: {
    title: string;
    subtitle: string;
    returnHome: string;
    loadTimeline: string;
    placeholders: { requestId: string; prescriptionId: string };
  };
  preview: { title: string; subtitle: string };
  legal: {
    title: string;
    bullets: readonly string[];
    surfaceNotes: { intake: string; request: string; report_delivery: string };
  };
  i18n: { label: string; en: string; it: string };
};

const DICTS: Record<Locale, Messages> = {
  en,
  it,
};

export function getLocaleFromAcceptLanguage(acceptLang: string | null | undefined): Locale {
  if (!acceptLang) return DEFAULT_LOCALE;
  const lower = acceptLang.toLowerCase();
  if (lower.includes('it')) return 'it';
  return 'en';
}

export async function getRequestLocale(): Promise<Locale> {
  const c = await cookies();
  const cookieLocale = c.get('locale')?.value ?? null;
  if (isSupportedLocale(cookieLocale)) return cookieLocale;
  const h = await headers();
  const accept = h.get('accept-language');
  return getLocaleFromAcceptLanguage(accept);
}

export function getDictionary(locale: Locale): Messages {
  return DICTS[locale] ?? en;
}

export { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from './locales';
