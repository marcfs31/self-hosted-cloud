import type { Dictionary } from "./en.js";

export const ca: Dictionary = {
  tray: {
    tooltip: "Cloud: {status}",
    statusIdle: "Al dia",
    statusSyncing: "Sincronitzant…",
    statusSyncingOne: "Sincronitzant 1 fitxer",
    statusSyncingMany: "Sincronitzant {count} fitxers",
    statusPaused: "En pausa",
    statusOffline: "Sense connexió",
    statusError: "Error: {reason}",
    statusNotConfigured: "Encara sense configurar",
    openFolder: "Obre la carpeta del núvol",
    openBrowser: "Obre al navegador",
    pause: "Posa en pausa la sincronització",
    resume: "Reprèn la sincronització",
    settings: "Configuració…",
    quit: "Surt de Cloud",
  },
  notifications: {
    conflictOneTitle: "S'han conservat les dues versions",
    conflictOneBody:
      "{name} ha canviat en dos ordinadors. Hi ha una còpia al costat de l'original.",
    conflictManyTitle: "{count} fitxers han canviat en dos llocs",
    conflictManyBody:
      "S'han conservat les dues versions de cada fitxer. Cerqueu les còpies al costat dels originals.",
    problemTitle: "La sincronització necessita atenció",
    problemBody: "{reason}",
    problemItemsBody: "No s'han pogut sincronitzar {count} elements. {reason}",
  },
  reasons: {
    unauthenticated:
      "El servidor no ha acceptat la contrasenya d'aplicació. Introduïu-ne una de nova a Configuració.",
    account_changed:
      "Aquesta carpeta es va sincronitzar amb un altre compte. Trieu una altra carpeta a Configuració.",
    local_root_missing:
      "No es troba la carpeta del núvol. Torneu a connectar la unitat o trieu la carpeta de nou.",
    config_damaged:
      "No s'ha pogut llegir la configuració desada. Introduïu-la de nou a Configuració.",
    credentials_unreadable:
      "No s'ha pogut desbloquejar la contrasenya desada. Introduïu-la de nou a Configuració.",
    quota_exceeded: "L'espai del vostre núvol és ple.",
    case_collision: "Dos noms només es diferencien en majúscules i minúscules.",
    invalid_name: "El servidor no permet aquest nom.",
    name_conflict: "Ja existeix un element amb aquest nom.",
    changed_during_sync: "El fitxer ha canviat mentre se sincronitzava.",
    too_many_attempts: "Massa intents. La sincronització ho tornarà a provar aviat.",
    origin_rejected: "El servidor ha rebutjat la sol·licitud.",
    internal: "El servidor ha tingut un problema. La sincronització ho tornarà a provar.",
    EACCES: "S'ha denegat el permís per usar el fitxer.",
    EPERM: "S'ha denegat el permís per usar el fitxer.",
    ENOSPC: "El disc és ple.",
    EBUSY: "Un altre programa està usant el fitxer.",
    unknown: "Ha passat alguna cosa inesperada.",
  },
  settings: {
    windowTitle: "Configuració de Cloud",
    heading: "Connecteu-vos al vostre núvol",
    intro:
      "Els fitxers de la carpeta de sota es mantenen sincronitzats amb el vostre propi servidor.",
    statusLabel: "Estat",
    serverLabel: "Adreça del servidor",
    serverHint:
      "Per exemple https://cloud.exemple.cat. L'http simple només s'accepta per a localhost.",
    emailLabel: "Correu electrònic",
    passwordLabel: "Contrasenya d'aplicació",
    passwordHint:
      "Creeu-ne una a l'aplicació web, a Seguretat. Es desa xifrada pel sistema i no es torna a mostrar.",
    passwordSaved: "Ja hi ha una contrasenya desada. Deixeu-ho buit per conservar-la.",
    folderLabel: "Carpeta local",
    folderChoose: "Tria…",
    deviceLabel: "Nom del dispositiu",
    deviceHint: "Serveix per nomenar les còpies de conflicte i saber quin ordinador les ha creat.",
    launchLabel: "Obre Cloud en iniciar la sessió",
    testButton: "Prova la connexió",
    saveButton: "Desa",
    testing: "Provant…",
    saving: "Desant…",
    saved: "Configuració desada.",
    unexpected: "Ha passat alguna cosa inesperada. Torneu-ho a provar.",
    validation: {
      invalid_input: "Alguns valors no són vàlids.",
      server_required: "Introduïu l'adreça del servidor.",
      server_invalid:
        "Aquesta adreça de servidor no és vàlida. Useu el format https://cloud.exemple.cat.",
      server_insecure: "Useu https://. L'http simple només s'accepta per a localhost.",
      email_invalid: "Introduïu un correu electrònic vàlid.",
      password_required: "Introduïu la contrasenya d'aplicació.",
      secure_storage_unavailable:
        "Aquest ordinador no pot xifrar secrets (no hi ha cap clauer del sistema disponible), de manera que la contrasenya d'aplicació no es desa.",
      folder_required: "Trieu una carpeta.",
      folder_not_absolute: "Trieu la ruta completa d'una carpeta.",
      folder_unsafe: "Trieu una carpeta pròpia, no la carpeta personal ni l'arrel d'una unitat.",
      folder_unusable: "No s'ha pogut crear ni obrir la carpeta.",
      device_name_required: "Introduïu un nom de dispositiu.",
      device_name_too_long: "Useu com a màxim 64 caràcters.",
      save_failed: "No s'ha pogut desar la configuració.",
    },
    connection: {
      ok: "Connectat com a {email}.",
      unauthenticated: "El servidor no ha acceptat aquesta contrasenya d'aplicació.",
      email_mismatch: "Aquesta contrasenya d'aplicació pertany a {email}, no al correu introduït.",
      network: "No s'ha pogut contactar amb el servidor. Comproveu l'adreça i la connexió.",
      server_error: "El servidor ha respost amb un error. Torneu-ho a provar d'aquí a un moment.",
      bad_response: "Aquesta adreça no sembla d'un servidor Cloud.",
    },
  },
};
