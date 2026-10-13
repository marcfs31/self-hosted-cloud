import type { System } from "./en";

export const ptPT: System = {
  title: "Sistema",
  adminLink: "Estado do sistema",
  adminLinkNote: "Como estão o servidor, o armazenamento e as cópias de segurança.",
  refresh: "Atualizar",
  refreshing: "A atualizar…",
  loading: "A carregar o estado do sistema…",
  lastUpdated: (time) => `Atualizado às ${time}`,
  updatedNotice: "Estado atualizado",
  autoRefresh: "Atualiza sozinho de 30 em 30 segundos enquanto este separador estiver visível.",
  outdatedBadge: "Desatualizado",
  refreshFailed: (time) =>
    `Não foi possível atualizar o estado. Está a ver o que o servidor indicou às ${time}.`,
  unknown: "Desconhecido",
  server: {
    title: "Este servidor",
    version: "Versão",
    uptime: "Em funcionamento há",
    cores: "Núcleos do processador",
    load: "Carga média (1 / 5 / 15 min)",
    temperature: "Temperatura",
  },
  memory: {
    title: "Memória",
    label: "Memória em utilização",
    usedOf: (used, total) => `${used} de ${total}`,
    available: (value) => `${value} disponíveis`,
  },
  storage: {
    title: "Armazenamento",
    label: "Armazenamento utilizado em /data",
    usedOf: (used, total) => `${used} de ${total}`,
    free: (value) => `${value} livres`,
    unknown: "Desconhecido. O servidor não conseguiu ler o disco.",
  },
  checks: {
    title: "Verificações do anfitrião",
    intro: "As tarefas agendadas no anfitrião comunicam aqui os seus resultados.",
    backup: "Cópia de segurança",
    restoreTest: "Teste de restauro",
    health: "Estado de saúde",
    state: {
      ok: "Correto",
      failing: "Com falhas",
      stale: "Em atraso",
      unknown: "Desconhecido",
    },
    checked: (relative, exact) => `Verificado ${relative} (${exact})`,
    neverReported: "Nunca comunicou",
    help: {
      failing:
        "A última execução comunicou um problema. Consulte o registo no anfitrião para perceber porquê.",
      stale: (age) =>
        `O anfitrião não comunica há ${age}. Verifique se o temporizador do systemd continua a funcionar.`,
      unknown:
        "O anfitrião nunca enviou um relatório ou não foi possível lê-lo. Verifique se o temporizador do systemd está instalado e já foi executado.",
    },
    noFacts: "Não foram comunicados detalhes.",
    facts: {
      endpoint: "Ponto de verificação de saúde (estado HTTP)",
      freePercent: "Espaço livre (%)",
      smart: "Estado SMART",
      repositories: "Repositórios",
      failedRepositories: "Repositórios com falhas",
      snapshot: "Instantâneo da base de dados",
      integrity: "Integridade",
      files: "Ficheiros restaurados / listados",
    },
  },
};
