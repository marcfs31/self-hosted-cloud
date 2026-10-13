import type { Dictionary } from "./en.js";

export const it: Dictionary = {
  tray: {
    tooltip: "Cloud: {status}",
    statusIdle: "Aggiornato",
    statusSyncing: "Sincronizzazione…",
    statusSyncingOne: "Sincronizzazione di 1 file",
    statusSyncingMany: "Sincronizzazione di {count} file",
    statusPaused: "In pausa",
    statusOffline: "Non in linea",
    statusError: "Errore: {reason}",
    statusNotConfigured: "Non ancora configurato",
    openFolder: "Apri la cartella del cloud",
    openBrowser: "Apri nel browser",
    pause: "Metti in pausa la sincronizzazione",
    resume: "Riprendi la sincronizzazione",
    settings: "Impostazioni…",
    quit: "Esci da Cloud",
  },
  notifications: {
    conflictOneTitle: "Sono state conservate entrambe le versioni",
    conflictOneBody: "{name} è cambiato su due computer. Una copia si trova accanto all'originale.",
    conflictManyTitle: "{count} file modificati in due posti",
    conflictManyBody:
      "Sono state conservate entrambe le versioni di ogni file. Cerca le copie accanto agli originali.",
    problemTitle: "La sincronizzazione richiede attenzione",
    problemBody: "{reason}",
    problemItemsBody: "Non è stato possibile sincronizzare {count} elementi. {reason}",
  },
  reasons: {
    unauthenticated:
      "Il server non ha accettato la password dell'app. Inseriscine una nuova nelle Impostazioni.",
    account_changed:
      "Questa cartella è stata sincronizzata con un altro account. Scegli un'altra cartella nelle Impostazioni.",
    local_root_missing:
      "La cartella del cloud non si trova. Ricollega l'unità o scegli di nuovo la cartella.",
    config_damaged: "Non è stato possibile leggere le impostazioni salvate. Inseriscile di nuovo.",
    credentials_unreadable:
      "Non è stato possibile sbloccare la password salvata. Inseriscila di nuovo nelle Impostazioni.",
    quota_exceeded: "Lo spazio del tuo cloud è pieno.",
    case_collision: "Due nomi differiscono solo per le maiuscole e le minuscole.",
    invalid_name: "Il server non consente questo nome.",
    name_conflict: "Esiste già un elemento con questo nome.",
    changed_during_sync: "Il file è cambiato durante la sincronizzazione.",
    too_many_attempts: "Troppi tentativi. La sincronizzazione riproverà a breve.",
    origin_rejected: "Il server ha rifiutato la richiesta.",
    internal: "Il server ha avuto un problema. La sincronizzazione riproverà.",
    EACCES: "Permesso negato per l'uso del file.",
    EPERM: "Permesso negato per l'uso del file.",
    ENOSPC: "Il disco è pieno.",
    EBUSY: "Il file è in uso da un altro programma.",
    unknown: "Si è verificato qualcosa di imprevisto.",
  },
  settings: {
    windowTitle: "Impostazioni di Cloud",
    heading: "Collegati al tuo cloud",
    intro: "I file nella cartella qui sotto restano sincronizzati con il tuo server.",
    statusLabel: "Stato",
    serverLabel: "Indirizzo del server",
    serverHint:
      "Ad esempio https://cloud.esempio.it. L'http semplice è accettato solo per localhost.",
    emailLabel: "Indirizzo email",
    passwordLabel: "Password dell'app",
    passwordHint:
      "Creane una nell'app web, in Sicurezza. Viene salvata cifrata dal sistema e non viene mostrata di nuovo.",
    passwordSaved: "Una password è già salvata. Lascia vuoto per mantenerla.",
    folderLabel: "Cartella locale",
    folderChoose: "Scegli…",
    deviceLabel: "Nome del dispositivo",
    deviceHint:
      "Serve a dare un nome alle copie di conflitto, così sai quale computer le ha create.",
    launchLabel: "Apri Cloud all'accesso",
    testButton: "Prova la connessione",
    saveButton: "Salva",
    testing: "Prova in corso…",
    saving: "Salvataggio…",
    saved: "Impostazioni salvate.",
    unexpected: "Si è verificato qualcosa di imprevisto. Riprova.",
    validation: {
      invalid_input: "Alcuni valori non sono validi.",
      server_required: "Inserisci l'indirizzo del server.",
      server_invalid:
        "Questo indirizzo del server non è valido. Usa la forma https://cloud.esempio.it.",
      server_insecure: "Usa https://. L'http semplice è accettato solo per localhost.",
      email_invalid: "Inserisci un indirizzo email valido.",
      password_required: "Inserisci la password dell'app.",
      secure_storage_unavailable:
        "Questo computer non può cifrare i segreti (nessun portachiavi di sistema disponibile), quindi la password dell'app non viene salvata.",
      folder_required: "Scegli una cartella.",
      folder_not_absolute: "Scegli il percorso completo di una cartella.",
      folder_unsafe:
        "Scegli una cartella dedicata, non la cartella personale né la radice di un'unità.",
      folder_unusable: "Non è stato possibile creare o aprire la cartella.",
      device_name_required: "Inserisci un nome per il dispositivo.",
      device_name_too_long: "Usa al massimo 64 caratteri.",
      save_failed: "Non è stato possibile salvare le impostazioni.",
    },
    connection: {
      ok: "Connesso come {email}.",
      unauthenticated: "Il server non ha accettato questa password dell'app.",
      email_mismatch: "Questa password dell'app appartiene a {email}, non all'email inserita.",
      network: "Impossibile raggiungere il server. Controlla l'indirizzo e la connessione.",
      server_error: "Il server ha risposto con un errore. Riprova tra un attimo.",
      bad_response: "Questo indirizzo non sembra quello di un server Cloud.",
    },
  },
};
