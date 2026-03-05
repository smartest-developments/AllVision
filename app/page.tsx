import { getLegalCopy } from "@/legal/disclaimers";

export default function HomePage() {
  const legal = getLegalCopy("request");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
      <h1 className="text-4xl font-semibold">AllVision</h1>
      <p className="text-lg">
        Documentation-first bootstrap. This service provides informational
        price-comparison and sourcing reports for eyeglass lenses in the EU and
        Switzerland.
      </p>
      <ul className="list-disc pl-6 text-sm">
        {legal.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
        <li>{legal.surfaceNote}</li>
      </ul>
    </main>
  );
}
