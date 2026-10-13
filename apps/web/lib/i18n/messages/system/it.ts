import type { System } from "./en";

export const it: System = {
  title: "Sistema",
  adminLink: "Stato del sistema",
  adminLinkNote: "Come stanno andando il server, l'archiviazione e i backup.",
  refresh: "Aggiorna",
  refreshing: "Aggiornamento…",
  loading: "Caricamento dello stato del sistema…",
  lastUpdated: (time) => `Aggiornato alle ${time}`,
  updatedNotice: "Stato aggiornato",
  autoRefresh: "Si aggiorna da solo ogni 30 secondi finché questa scheda è visibile.",
  outdatedBadge: "Non aggiornato",
  refreshFailed: (time) =>
    `Impossibile aggiornare lo stato. Stai vedendo quanto ha riferito il server alle ${time}.`,
  unknown: "Sconosciuto",
  server: {
    title: "Questo server",
    version: "Versione",
    uptime: "In funzione da",
    cores: "Core del processore",
    load: "Carico medio (1 / 5 / 15 min)",
    temperature: "Temperatura",
  },
  memory: {
    title: "Memoria",
    label: "Memoria in uso",
    usedOf: (used, total) => `${used} su ${total}`,
    available: (value) => `${value} disponibili`,
  },
  storage: {
    title: "Archiviazione",
    label: "Archiviazione usata in /data",
    usedOf: (used, total) => `${used} su ${total}`,
    free: (value) => `${value} liberi`,
    unknown: "Sconosciuto. Il server non è riuscito a leggere il disco.",
  },
  checks: {
    title: "Controlli dell'host",
    intro: "I processi pianificati sull'host riportano qui i loro risultati.",
    backup: "Backup",
    restoreTest: "Test di ripristino",
    health: "Stato di salute",
    state: {
      ok: "In ordine",
      failing: "Con errori",
      stale: "In ritardo",
      unknown: "Sconosciuto",
    },
    checked: (relative, exact) => `Controllato ${relative} (${exact})`,
    neverReported: "Mai riportato",
    help: {
      failing:
        "L'ultima esecuzione ha segnalato un problema. Controlla il log sull'host per capirne il motivo.",
      stale: (age) =>
        `L'host non riporta da ${age}. Controlla che il suo timer systemd sia ancora attivo.`,
      unknown:
        "L'host non ha mai inviato un report oppure non è stato possibile leggerlo. Controlla che il timer systemd sia installato e sia già stato eseguito.",
    },
    noFacts: "Nessun dettaglio riportato.",
    facts: {
      endpoint: "Endpoint di controllo (stato HTTP)",
      freePercent: "Spazio libero (%)",
      smart: "Stato SMART",
      repositories: "Repository",
      failedRepositories: "Repository con errori",
      snapshot: "Snapshot del database",
      integrity: "Integrità",
      files: "File ripristinati / elencati",
    },
  },
};
