export type Locale = 'en' | 'it';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'it'];
export const DEFAULT_LOCALE: Locale = 'en';

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return value === 'en' || value === 'it';
}
