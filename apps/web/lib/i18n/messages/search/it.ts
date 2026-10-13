import { isOne } from "../../plural";
import type { Search } from "./en";

export const it: Search = {
  title: "Ricerca",
  field: {
    label: "Cerca file",
    placeholder: "Cerca per nome…",
    submit: "Cerca",
  },
  idle: "Scrivi una parte del nome di un file o di una cartella per trovarlo.",
  searching: "Ricerca in corso…",
  count: (n, q) => (isOne("it", n) ? `${n} risultato per “${q}”` : `${n} risultati per “${q}”`),
  none: {
    title: (q) => `Nessun risultato per “${q}”`,
    hint: "Controlla l'ortografia o prova con una parte più breve del nome.",
  },
  limited: (n) =>
    `Sono mostrate le prime ${n} corrispondenze. Scrivi più del nome per restringerle.`,
  caption: (q) => `Risultati per ${q}`,
  location: "Posizione",
  pathLabel: (name) => `Dove si trova ${name}`,
  preview: {
    controls: "Controlli dell'anteprima",
    previous: "File precedente",
    next: "File successivo",
    position: (n, total) => `${n} di ${total}`,
    download: "Scarica",
    loading: "Caricamento dell'anteprima…",
    truncated: (shown, total) =>
      `Sono mostrati i primi ${shown} di ${total}. Scarica il file per leggerlo per intero.`,
    empty: "Questo file è vuoto.",
    unavailable: "Questo tipo di file non può essere mostrato qui. Puoi scaricarlo.",
  },
};
