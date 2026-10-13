import type { Errors } from "./en";

export const it: Errors = {
  invalid_request: "Alcuni dati non sembrano corretti. Controllali e riprova.",
  unauthenticated: "La tua sessione è terminata. Accedi di nuovo.",
  not_found: "Non abbiamo trovato quello che cerchi. Potrebbe essere stato rimosso.",
  origin_rejected:
    "Questa richiesta non proviene dalla pagina prevista. Ricarica la pagina e riprova.",
  too_many_attempts: "Troppi tentativi per ora. Attendi qualche minuto e riprova.",
  setup_already_done: "Questo cloud è già configurato. Accedi.",
  invalid_credentials: "L'email e la password non corrispondono. Riprova.",
  invite_invalid:
    "Questo link d'invito non è più valido. Chiedine uno nuovo a chi amministra il cloud.",
  email_taken: "Esiste già un account con questa email.",
  cannot_change_self: "Non puoi modificare il tuo stesso account da qui.",
  name_conflict: "Qui c'è già un elemento con questo nome. Scegli un altro nome.",
  invalid_move: "Questo elemento non può essere spostato o modificato in questo modo.",
  quota_exceeded: "Non c'è abbastanza spazio libero nel tuo archivio per questo.",
  version_is_current: "Questa è la versione attuale. Ripristina prima un'altra versione.",
  thumbnail_unavailable: "Anteprima non disponibile per questo file.",
  share_locked: "Questo link è protetto. Inserisci la password per aprirlo.",
  internal: "Qualcosa è andato storto da parte nostra. Riprova tra un attimo.",
};
