import type { Common } from "./en";

export const ca: Common = {
  app: {
    name: "Cloud",
    description: "El teu núvol, allotjat per tu",
    loading: "Carregant…",
    skipToContent: "Salta al contingut",
    retry: "Torna-ho a provar",
    mainNavLabel: "Principal",
  },
  nav: {
    files: "Fitxers",
    admin: "Administració",
    logout: "Tanca la sessió",
    loggingOut: "Tancant la sessió…",
  },
  roles: {
    admin: "Admin",
    member: "Membre",
  },
  localeSwitcher: {
    label: "Llengua",
  },
  home: {
    title: "Fitxers",
    signedInAs: (email) => `Sessió iniciada com a ${email}`,
    comingSoon: "La navegació pels fitxers arribarà a la propera versió.",
  },
  notFound: {
    title: "No s'ha trobat la pàgina",
    body: "Aquesta pàgina no existeix o no hi tens accés.",
    home: "Torna als fitxers",
  },
};
