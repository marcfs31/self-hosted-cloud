import type { Common } from "./en";

export const es: Common = {
  app: {
    name: "Cloud",
    description: "Tu nube, alojada por ti",
    loading: "Cargando…",
    skipToContent: "Saltar al contenido",
    retry: "Intentarlo de nuevo",
    mainNavLabel: "Principal",
  },
  nav: {
    files: "Archivos",
    admin: "Administración",
    logout: "Cerrar sesión",
    loggingOut: "Cerrando sesión…",
  },
  roles: {
    admin: "Admin",
    member: "Miembro",
  },
  localeSwitcher: {
    label: "Idioma",
  },
  home: {
    title: "Archivos",
    signedInAs: (email) => `Sesión iniciada como ${email}`,
    comingSoon: "La navegación por los archivos llegará en la próxima versión.",
  },
  notFound: {
    title: "Página no encontrada",
    body: "Esta página no existe o no tienes acceso a ella.",
    home: "Volver a los archivos",
  },
};
