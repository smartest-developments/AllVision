export const en = {
  nav: {
    home: 'Home',
    timeline: 'Timeline',
    admin: 'Admin',
    gdpr: 'GDPR'
  },
  home: {
    title: 'AllVision',
    tagline:
      'Documentation-first bootstrap. This service provides informational price-comparison and sourcing reports for eyeglass lenses in the EU and Switzerland.',
    timelineTitle: 'Sourcing request timeline',
    timelineIntro: 'Authenticated preview: timeline cards load from your current session.'
  },
  timeline: {
    title: 'Sourcing timeline',
    subtitle: 'Owner-scoped request timeline with optional request deep-linking.',
    returnHome: 'Return to home',
    loadTimeline: 'Load timeline',
    placeholders: {
      requestId: 'request-id (optional)',
      prescriptionId: 'prescription-id (optional)'
    }
  },
  preview: {
    title: 'AllVision — Public Preview',
    subtitle: 'Read-only demo with mock data. No authentication, API, or database calls.'
  },
  legal: {
    title: 'Legal Notice',
    bullets: [
      'Informational service only. AllVision does not sell lenses or medical devices.',
      'No brokerage or transaction execution is performed by AllVision.',
      'No medical advice is provided. Users remain responsible for purchase and care decisions.'
    ],
    surfaceNotes: {
      intake: 'Prescription data is used only to prepare your informational sourcing report.',
      request: 'Sourcing requests are reviewed manually before report publication.',
      report_delivery: 'Report delivery confirms access to information, not product fulfillment.'
    }
  },
  i18n: {
    label: 'Language',
    en: 'English',
    it: 'Italiano'
  }
} as const;
export type EnDict = typeof en;
