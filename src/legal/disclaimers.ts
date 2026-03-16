export type LegalSurface = "intake" | "request" | "report_delivery";
import { getDictionary, type Locale } from "@/i18n";

type LegalCopy = {
  title: string;
  bullets: string[];
  surfaceNote: string;
};

export function getLegalCopy(surface: LegalSurface, locale: Locale = 'en'): LegalCopy {
  const dict = getDictionary(locale);
  return {
    title: dict.legal.title,
    bullets: [...dict.legal.bullets],
    surfaceNote: dict.legal.surfaceNotes[surface],
  };
}
