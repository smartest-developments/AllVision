import Link from 'next/link';
import { getRequestLocale, getDictionary } from '@/i18n';

export default async function LanguageSwitcher() {
  const locale = await getRequestLocale();
  const t = getDictionary(locale);
  const isEn = locale === 'en';
  const isIt = locale === 'it';
  return (
    <nav aria-label={t.i18n.label} className="ml-auto flex items-center gap-2 text-xs text-neutral-700">
      <span>{t.i18n.label}:</span>
      <Link className={`underline ${isEn ? 'font-semibold' : ''}`} href="?lang=en" prefetch={false}>{t.i18n.en}</Link>
      <Link className={`underline ${isIt ? 'font-semibold' : ''}`} href="?lang=it" prefetch={false}>{t.i18n.it}</Link>
    </nav>
  );
}
