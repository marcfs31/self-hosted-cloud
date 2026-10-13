import type { System } from "./en";

export const ca: System = {
  title: "Sistema",
  adminLink: "Estat del sistema",
  adminLinkNote: "Com van el servidor, l'emmagatzematge i les còpies de seguretat.",
  refresh: "Actualitza",
  refreshing: "Actualitzant…",
  loading: "Carregant l'estat del sistema…",
  lastUpdated: (time) => `Actualitzat a les ${time}`,
  updatedNotice: "Estat actualitzat",
  autoRefresh: "S'actualitza sol cada 30 segons mentre aquesta pestanya sigui visible.",
  outdatedBadge: "Desactualitzat",
  refreshFailed: (time) =>
    `No s'ha pogut actualitzar l'estat. Estàs veient el que va informar el servidor a les ${time}.`,
  unknown: "Desconegut",
  server: {
    title: "Aquest servidor",
    version: "Versió",
    uptime: "Engegat des de fa",
    cores: "Nuclis del processador",
    load: "Càrrega mitjana (1 / 5 / 15 min)",
    temperature: "Temperatura",
  },
  memory: {
    title: "Memòria",
    label: "Memòria en ús",
    usedOf: (used, total) => `${used} de ${total}`,
    available: (value) => `${value} disponibles`,
  },
  storage: {
    title: "Emmagatzematge",
    label: "Emmagatzematge en ús a /data",
    usedOf: (used, total) => `${used} de ${total}`,
    free: (value) => `${value} lliures`,
    unknown: "Desconegut. El servidor no ha pogut llegir el disc.",
  },
  checks: {
    title: "Comprovacions de l'amfitrió",
    intro: "Les tasques programades a l'amfitrió informen aquí dels resultats.",
    backup: "Còpia de seguretat",
    restoreTest: "Prova de restauració",
    health: "Salut",
    state: {
      ok: "Correcte",
      failing: "Amb errors",
      stale: "Endarrerit",
      unknown: "Desconegut",
    },
    checked: (relative, exact) => `Comprovat ${relative} (${exact})`,
    neverReported: "Mai ha informat",
    help: {
      failing:
        "L'última execució ha informat d'un problema. Consulta el registre a l'amfitrió per saber-ne el motiu.",
      stale: (age) =>
        `L'amfitrió no informa des de fa ${age}. Comprova que el seu temporitzador de systemd continua funcionant.`,
      unknown:
        "L'amfitrió mai no ha enviat cap informe o no s'ha pogut llegir. Comprova que el temporitzador de systemd està instal·lat i s'ha executat.",
    },
    noFacts: "No s'ha informat de cap detall.",
    facts: {
      endpoint: "Punt de comprovació de salut (estat HTTP)",
      freePercent: "Espai lliure (%)",
      smart: "Estat SMART",
      repositories: "Repositoris",
      failedRepositories: "Repositoris amb errors",
      snapshot: "Instantània de la base de dades",
      integrity: "Integritat",
      files: "Fitxers restaurats / llistats",
    },
  },
};
