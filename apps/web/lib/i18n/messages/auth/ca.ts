import type { Auth } from "./en";

export const ca: Auth = {
  email: "Correu electrònic",
  password: "Contrasenya",
  passwordHint: "Com a mínim 12 caràcters. Unes quantes paraules a l'atzar funcionen bé.",
  confirmPassword: "Confirma la contrasenya",
  passwordTooShort: "La contrasenya ha de tenir com a mínim 12 caràcters.",
  passwordMismatch: "Les dues contrasenyes no coincideixen.",
  setupTitle: "Configura el teu núvol",
  setupIntro: "Crea el primer compte. Serà el d'administració.",
  setupSubmit: "Crea el compte d'administració",
  setupSubmitting: "Creant…",
  loginTitle: "Inicia la sessió",
  loginSubmit: "Inicia la sessió",
  loginSubmitting: "Iniciant la sessió…",
  loginNoAccount:
    "Necessites un compte? Demana un enllaç d'invitació a l'administració d'aquest núvol.",
  registerTitle: "Accepta la invitació",
  registerIntro: "Tria un correu electrònic i una contrasenya per crear el teu compte.",
  registerSubmit: "Crea el compte",
  registerSubmitting: "Creant…",
  registerMissingToken:
    "Aquest enllaç d'invitació és incomplet. Demana'n un de nou a l'administració.",
  registerHaveAccount: "Ja tens un compte?",
  registerLoginLink: "Inicia la sessió",
};
