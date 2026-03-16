export const it = {
  nav: {
    home: 'Home',
    timeline: 'Timeline',
    admin: 'Admin',
    gdpr: 'GDPR'
  },
  home: {
    title: 'AllVision',
    tagline:
      "Bootstrap guidato dalla documentazione. Il servizio fornisce report informativi di confronto prezzi e sourcing per lenti da vista in UE e Svizzera.",
    timelineTitle: 'Timeline delle richieste di sourcing',
    timelineIntro: "Anteprima autenticata: le card della timeline si caricano dalla tua sessione corrente."
  },
  timeline: {
    title: 'Timeline sourcing',
    subtitle: 'Timeline delle richieste visibile al proprietario, con deep-link facoltativo.',
    returnHome: 'Torna alla home',
    loadTimeline: 'Carica timeline',
    placeholders: {
      requestId: 'id-richiesta (opzionale)',
      prescriptionId: 'id-prescrizione (opzionale)'
    }
  },
  preview: {
    title: 'AllVision — Anteprima Pubblica',
    subtitle: 'Demo in sola lettura con dati fittizi. Nessuna autenticazione, API o database.'
  },
  legal: {
    title: 'Note legali',
    bullets: [
      'Servizio puramente informativo. AllVision non vende lenti o dispositivi medici.',
      'AllVision non svolge attività di intermediazione o esecuzione di transazioni.',
      'Nessun consiglio medico fornito. Le decisioni di acquisto e cura restano a carico dell’utente.'
    ],
    surfaceNotes: {
      intake: 'I dati della prescrizione sono usati solo per preparare il tuo report informativo di sourcing.',
      request: 'Le richieste di sourcing sono revisionate manualmente prima della pubblicazione del report.',
      report_delivery: 'La consegna del report conferma l’accesso a informazioni, non l’adempimento di un prodotto.'
    }
  },
  i18n: {
    label: 'Lingua',
    en: 'English',
    it: 'Italiano'
  }
} as const;
export type ItDict = typeof it;
