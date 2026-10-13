import type { Errors } from "./en";

export const ca: Errors = {
  invalid_request: "Algunes dades no semblen correctes. Revisa-les i torna-ho a provar.",
  unauthenticated: "La teva sessió ha acabat. Torna a iniciar la sessió.",
  not_found: "No hem trobat el que busques. Potser s'ha eliminat.",
  origin_rejected:
    "Aquesta sol·licitud no prové de la pàgina esperada. Recarrega la pàgina i torna-ho a provar.",
  too_many_attempts: "Massa intents per ara. Espera uns minuts i torna-ho a provar.",
  setup_already_done: "Aquest núvol ja està configurat. Inicia la sessió.",
  invalid_credentials: "El correu electrònic i la contrasenya no coincideixen. Torna-ho a provar.",
  invite_invalid: "Aquest enllaç d'invitació ja no és vàlid. Demana'n un de nou a l'administració.",
  email_taken: "Ja existeix un compte amb aquest correu electrònic.",
  cannot_change_self: "No pots canviar el teu propi compte des d'aquí.",
  name_conflict: "Ja hi ha un element amb aquest nom aquí. Tria un altre nom.",
  invalid_move: "Aquest element no es pot moure ni canviar d'aquesta manera.",
  quota_exceeded: "No queda prou espai al teu emmagatzematge per a això.",
  version_is_current: "Aquesta és la versió actual. Restaura primer una altra versió.",
  mfa_required: "Escriu el codi de la teva aplicació d'autenticació per continuar.",
  invalid_code: "Aquest codi no ha funcionat. Revisa'l i torna-ho a provar.",
  internal:
    "Alguna cosa ha anat malament per la nostra banda. Torna-ho a provar d'aquí a un moment.",
};
