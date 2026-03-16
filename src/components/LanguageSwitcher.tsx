import Link from 'next/link';
import { getRequestLocale } from '@/i18n';

export default async function LanguageSwitcher() {
  const locale = await getRequestLocale();
  const isEn = locale === 'en';
  const isIt = locale === 'it';
  return (
    <nav aria-label="Language switch" className="ml-auto flex items-center gap-2 text-xs text-neutral-700">
      <span>Lang:</span>
      <Link className={`underline ${isEn ? 'font-semibold' : ''}`} href="?lang=en" prefetch={false}>EN</Link>
      <Link className={`underline ${isIt ? 'font-semibold' : ''}`} href="?lang=it" prefetch={false}>IT</Link>
    </nav>
  );
}
