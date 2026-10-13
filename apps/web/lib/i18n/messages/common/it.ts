import type { Common } from "./en";

export const it: Common = {
  app: {
    name: "Cloud",
    description: "Il tuo cloud, ospitato da te",
    loading: "Caricamento…",
    skipToContent: "Vai al contenuto",
    retry: "Riprova",
    mainNavLabel: "Principale",
  },
  nav: {
    files: "File",
    admin: "Amministrazione",
    logout: "Esci",
    loggingOut: "Uscita in corso…",
  },
  roles: {
    admin: "Admin",
    member: "Membro",
  },
  localeSwitcher: {
    label: "Lingua",
  },
  home: {
    title: "File",
    signedInAs: (email) => `Accesso eseguito come ${email}`,
    comingSoon: "La navigazione dei file arriverà nella prossima versione.",
  },
  notFound: {
    title: "Pagina non trovata",
    body: "Questa pagina non esiste o non hai accesso.",
    home: "Torna ai file",
  },
};
