import { isOne } from "../../plural";
import type { Activity } from "./en";

export const ca: Activity = {
  title: "Activitat",
  intro: "El que ha passat al teu compte, del més recent al més antic.",
  settingsLink: "Configuració de seguretat",
  loading: "Carregant l'activitat…",
  empty: "Encara no hi ha res per mostrar.",
  caption: "Activitat",
  colEvent: "Esdeveniment",
  colAccount: "Compte",
  colWhen: "Quan",
  colIp: "Adreça IP",
  colDetails: "Detalls",
  noIp: "Sense registrar",
  loadMore: "Carrega'n més",
  loadingMore: "Carregant…",
  loadedMore: (n) =>
    isOne("ca", n)
      ? `S'ha carregat ${n} esdeveniment més.`
      : `S'han carregat ${n} esdeveniments més.`,
  end: "Això és tot.",
  events: {
    login_succeeded: "Sessió iniciada",
    login_failed: "Intent d'inici de sessió fallit",
    logout: "Sessió tancada",
    passkey_added: "Clau d'accés afegida",
    passkey_removed: "Clau d'accés eliminada",
    totp_enabled: "Verificació en dos passos activada",
    totp_disabled: "Verificació en dos passos desactivada",
    mfa_reset_by_admin: "Verificació en dos passos restablerta per un administrador",
    password_changed: "Contrasenya canviada",
    app_password_created: "Contrasenya d'aplicació creada",
    app_password_revoked: "Contrasenya d'aplicació revocada",
    upload: "Fitxer pujat",
    trash: "Mogut a la paperera",
    restore: "Restaurat de la paperera",
    purge: "Eliminat per sempre",
    share_created: "Enllaç per compartir creat",
    share_revoked: "Enllaç per compartir revocat",
  },
  methods: {
    password: "Contrasenya",
    totp: "Codi d'autenticació",
    recovery_code: "Codi de recuperació",
    passkey: "Clau d'accés",
  },
  detail: {
    method: (method) => `Mètode: ${method}`,
    file: (name) => `Fitxer: ${name}`,
    passkey: (name) => `Clau d'accés: ${name}`,
    appPassword: (name) => `Contrasenya d'aplicació: ${name}`,
    by: (email) => `Fet per ${email}`,
  },
};
