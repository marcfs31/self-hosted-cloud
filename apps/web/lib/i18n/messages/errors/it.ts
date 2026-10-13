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
  internal: "Qualcosa è andato storto da parte nostra. Riprova tra un attimo.",
};
