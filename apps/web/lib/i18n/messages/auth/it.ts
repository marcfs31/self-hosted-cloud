import type { Auth } from "./en";

export const it: Auth = {
  email: "Email",
  password: "Password",
  passwordHint: "Almeno 12 caratteri. Qualche parola scelta a caso funziona bene.",
  confirmPassword: "Conferma la password",
  passwordTooShort: "La password deve contenere almeno 12 caratteri.",
  passwordMismatch: "Le due password non coincidono.",
  setupTitle: "Configura il tuo cloud",
  setupIntro: "Crea il primo account. Sarà quello di amministrazione.",
  setupSubmit: "Crea l'account di amministrazione",
  setupSubmitting: "Creazione in corso…",
  loginTitle: "Accedi",
  loginSubmit: "Accedi",
  loginSubmitting: "Accesso in corso…",
  loginNoAccount: "Ti serve un account? Chiedi un link d'invito a chi amministra questo cloud.",
  registerTitle: "Accetta l'invito",
  registerIntro: "Scegli un'email e una password per creare il tuo account.",
  registerSubmit: "Crea account",
  registerSubmitting: "Creazione in corso…",
  registerMissingToken:
    "Questo link d'invito è incompleto. Chiedine uno nuovo a chi amministra il cloud.",
  registerHaveAccount: "Hai già un account?",
  registerLoginLink: "Accedi",
};
