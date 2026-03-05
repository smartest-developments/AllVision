export type LegalSurface = "intake" | "request" | "report_delivery";

type LegalCopy = {
  title: string;
  bullets: string[];
  surfaceNote: string;
};

const BASE_BULLETS = [
  "Informational service only. AllVision does not sell lenses or medical devices.",
  "No brokerage or transaction execution is performed by AllVision.",
  "No medical advice is provided. Users remain responsible for purchase and care decisions."
] as const;

const SURFACE_NOTES: Record<LegalSurface, string> = {
  intake: "Prescription data is used only to prepare your informational sourcing report.",
  request: "Sourcing requests are reviewed manually before report publication.",
  report_delivery: "Report delivery confirms access to information, not product fulfillment."
};

export function getLegalCopy(surface: LegalSurface): LegalCopy {
  return {
    title: "Legal Notice",
    bullets: [...BASE_BULLETS],
    surfaceNote: SURFACE_NOTES[surface]
  };
}
