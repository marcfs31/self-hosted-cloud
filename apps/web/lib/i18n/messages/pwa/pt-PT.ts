import { isOne } from "../../plural";
import type { Pwa } from "./en";

export const ptPT: Pwa = {
  nav: { backup: "Cópia do telemóvel" },
  install: {
    region: "Instalar a aplicação",
    text: "Instale o Cloud neste dispositivo para o abrir como qualquer outra aplicação.",
    button: "Instalar aplicação",
    dismiss: "Agora não",
  },
  ios: {
    region: "Instalar a aplicação",
    text: "Para instalar o Cloud neste dispositivo, toque no botão Partilhar e escolha Adicionar ao ecrã principal.",
    dismiss: "Percebi",
  },
  update: { text: "Atualização disponível", reload: "Recarregar" },
  offline: {
    title: "Não é possível aceder ao Cloud",
    body: "Parece que está sem ligação ou que o servidor não responde. Os seus ficheiros estão seguros e voltam a aparecer assim que tiver ligação.",
    retry: "Tentar novamente",
  },
  picker: {
    hint: "Abra uma pasta para ver o que tem lá dentro e escolha a que pretende.",
    target: (folder) => `Pasta selecionada: ${folder}`,
    submit: "Usar esta pasta",
  },
  share: {
    title: "Partilhado com o Cloud",
    loading: "A procurar os ficheiros partilhados…",
    unsupported:
      "Este navegador não consegue entregar ficheiros partilhados ao Cloud. Use antes Carregar nos seus ficheiros.",
    empty: {
      title: "Não há nada para carregar aqui",
      hint: "Partilhe fotografias ou ficheiros com o Cloud a partir de outra aplicação e eles aparecem aqui.",
      back: "Voltar aos ficheiros",
    },
    listLabel: "Ficheiros partilhados",
    count: (n) =>
      isOne("pt-PT", n) ? `${n} ficheiro pronto a carregar` : `${n} ficheiros prontos a carregar`,
    destination: (folder) => `Carregar para: ${folder}`,
    chooseFolder: "Escolher outra pasta",
    pickerTitle: "Escolha para onde carregar",
    upload: "Carregar",
    uploading: "A carregar. O progresso aparece no painel de carregamentos.",
    discard: "Descartar",
    discarded: "Os ficheiros partilhados foram descartados.",
    finished: (n, folder) =>
      isOne("pt-PT", n)
        ? `Foi carregado ${n} ficheiro para ${folder}.`
        : `Foram carregados ${n} ficheiros para ${folder}.`,
    withFailures: (done, failed) =>
      `${done} carregados, ${failed} com falha. Pode repetir os que falharam no painel de carregamentos.`,
    openFolder: "Abrir a pasta",
  },
  backup: {
    title: "Cópia do telemóvel",
    intro:
      "Escolha as fotografias e os vídeos do seu telemóvel e o Cloud carrega os que ainda não tem. Os ficheiros que já estão na sua nuvem são ignorados, mesmo com outro nome.",
    limits:
      "A cópia só corre enquanto esta página estiver aberta. Os telemóveis não permitem que uma aplicação web faça cópias totalmente automáticas em segundo plano, por isso abra esta página de vez em quando e escolha as fotografias novas.",
    insecure:
      "A cópia do telemóvel precisa de uma ligação segura (https) para verificar os seus ficheiros. Abra o Cloud pelo endereço https.",
    destinationDefault: (folder) =>
      `Pasta da cópia: ${folder}, criada por si se ainda não existir.`,
    destinationChosen: (folder) => `Pasta da cópia: ${folder}`,
    chooseFolder: "Escolher outra pasta",
    useDefault: "Usar a pasta predefinida",
    pickerTitle: "Escolha a pasta da cópia",
    choose: "Escolher fotografias e vídeos",
    take: "Tirar fotografia",
    checking: (done, total) => `A verificar ${done} de ${total}…`,
    uploading: (done, total) => `A carregar: ${done} de ${total} concluídos`,
    summary: (already, uploaded, failed) =>
      `${already} já tinham cópia, ${uploaded} carregados, ${failed} com falha`,
    cancelled: (n) => (isOne("pt-PT", n) ? `${n} foi cancelado.` : `${n} foram cancelados.`),
    unchecked: (n) =>
      isOne("pt-PT", n)
        ? `${n} ficheiro grande foi carregado sem verificar duplicados (os ficheiros com mais de 512 MiB não são verificados).`
        : `${n} ficheiros grandes foram carregados sem verificar duplicados (os ficheiros com mais de 512 MiB não são verificados).`,
    failedHint: "Pode repetir os carregamentos que falharam no painel de carregamentos.",
  },
};
