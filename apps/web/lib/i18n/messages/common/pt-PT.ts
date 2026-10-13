import type { Common } from "./en";

export const ptPT: Common = {
  app: {
    name: "Cloud",
    description: "A sua cloud, alojada por si",
    loading: "A carregar…",
    skipToContent: "Saltar para o conteúdo",
    retry: "Tentar novamente",
    mainNavLabel: "Principal",
  },
  nav: {
    files: "Ficheiros",
    admin: "Administração",
    logout: "Terminar sessão",
    loggingOut: "A terminar sessão…",
  },
  roles: {
    admin: "Admin",
    member: "Membro",
  },
  localeSwitcher: {
    label: "Idioma",
  },
  home: {
    title: "Ficheiros",
    signedInAs: (email) => `Sessão iniciada como ${email}`,
    comingSoon: "A navegação pelos ficheiros chega na próxima versão.",
  },
  notFound: {
    title: "Página não encontrada",
    body: "Esta página não existe ou não tem acesso a ela.",
    home: "Voltar aos ficheiros",
  },
};
