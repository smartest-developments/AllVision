import type { Metadata } from "next";
import { getLegalCopy } from "@/legal/disclaimers";

export const metadata: Metadata = {
  title: "AllVision — Public Preview",
  robots: { index: false, follow: false },
};

export default function PublicPreviewPage() {
  const legal = getLegalCopy("request");
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 space-y-6">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold">AllVision — Public Preview</h1>
        <p className="text-sm text-neutral-700">
          Read-only demo with mock data. No authentication, API, or database calls.
        </p>
      </header>

      <section className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
        <h2 className="text-base font-medium">{legal.title}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-800">
          {legal.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-neutral-600">{legal.surfaceNote}</p>
      </section>

      <section className="text-sm text-neutral-700">
        <p>
          This preview is intended for visual review only. For functional flows
          (intake → review → delivery), run the app locally and use authenticated
          surfaces at <code className="rounded bg-neutral-100 px-1">/</code> and
          <code className="ml-1 rounded bg-neutral-100 px-1">/timeline</code>.
        </p>
      </section>
    </main>
  );
}
