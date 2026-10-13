import { isOne } from "../../plural";
import type { Pwa } from "./en";

export const it: Pwa = {
  nav: { backup: "Backup del telefono" },
  install: {
    region: "Installa l'app",
    text: "Installa Cloud su questo dispositivo per aprirlo come qualsiasi altra app.",
    button: "Installa l'app",
    dismiss: "Non ora",
  },
  ios: {
    region: "Installa l'app",
    text: "Per installare Cloud su questo dispositivo, tocca il pulsante Condividi e scegli Aggiungi a Home.",
    dismiss: "Ho capito",
  },
  update: { text: "Aggiornamento disponibile", reload: "Ricarica" },
  offline: {
    title: "Cloud non è raggiungibile",
    body: "Sembra che tu non sia connesso o che il server non risponda. I tuoi file sono al sicuro e ricompariranno appena sarai di nuovo connesso.",
    retry: "Riprova",
  },
  picker: {
    hint: "Apri una cartella per vedere cosa contiene, poi scegli quella che vuoi.",
    target: (folder) => `Cartella selezionata: ${folder}`,
    submit: "Usa questa cartella",
  },
  share: {
    title: "Condiviso con Cloud",
    loading: "Cerco i file condivisi…",
    unsupported:
      "Questo browser non può consegnare a Cloud i file condivisi. Usa invece Carica nei tuoi file.",
    empty: {
      title: "Qui non c'è nulla da caricare",
      hint: "Condividi foto o file con Cloud da un'altra app e compariranno qui.",
      back: "Torna ai file",
    },
    listLabel: "File condivisi",
    count: (n) =>
      isOne("it", n) ? `${n} file pronto da caricare` : `${n} file pronti da caricare`,
    destination: (folder) => `Carica in: ${folder}`,
    chooseFolder: "Scegli un'altra cartella",
    pickerTitle: "Scegli dove caricare",
    upload: "Carica",
    uploading: "Caricamento in corso. L'avanzamento è nel pannello dei caricamenti.",
    discard: "Scarta",
    discarded: "I file condivisi sono stati scartati.",
    finished: (n, folder) =>
      isOne("it", n) ? `Caricato ${n} file in ${folder}.` : `Caricati ${n} file in ${folder}.`,
    withFailures: (done, failed) =>
      `${done} caricati, ${failed} non riusciti. Puoi riprovare quelli falliti nel pannello dei caricamenti.`,
    openFolder: "Apri la cartella",
  },
  backup: {
    title: "Backup del telefono",
    intro:
      "Scegli le foto e i video del tuo telefono e Cloud carica quelli che non ha ancora. I file già presenti nel tuo cloud vengono saltati, anche se hanno un nome diverso.",
    limits:
      "Il backup funziona finché questa pagina è aperta. I telefoni non permettono a un'app web di fare backup del tutto automatici in background, quindi apri questa pagina ogni tanto e scegli le foto nuove.",
    insecure:
      "Il backup del telefono ha bisogno di una connessione sicura (https) per controllare i tuoi file. Apri Cloud dal suo indirizzo https.",
    destinationDefault: (folder) =>
      `Cartella del backup: ${folder}, creata per te se non esiste ancora.`,
    destinationChosen: (folder) => `Cartella del backup: ${folder}`,
    chooseFolder: "Scegli un'altra cartella",
    useDefault: "Usa la cartella predefinita",
    pickerTitle: "Scegli la cartella del backup",
    choose: "Scegli foto e video",
    take: "Scatta una foto",
    checking: (done, total) => `Controllo ${done} di ${total}…`,
    uploading: (done, total) => `Caricamento: ${done} di ${total} completati`,
    summary: (already, uploaded, failed) =>
      `${already} già nel backup, ${uploaded} caricati, ${failed} non riusciti`,
    cancelled: (n) => (isOne("it", n) ? `${n} è stato annullato.` : `${n} sono stati annullati.`),
    unchecked: (n) =>
      isOne("it", n)
        ? `${n} file grande è stato caricato senza controllo dei duplicati (i file oltre 512 MiB non vengono controllati).`
        : `${n} file grandi sono stati caricati senza controllo dei duplicati (i file oltre 512 MiB non vengono controllati).`,
    failedHint: "Puoi riprovare i caricamenti falliti nel pannello dei caricamenti.",
  },
};
