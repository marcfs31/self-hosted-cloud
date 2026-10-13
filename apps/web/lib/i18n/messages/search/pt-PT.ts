import { isOne } from "../../plural";
import type { Search } from "./en";

export const ptPT: Search = {
  title: "Pesquisa",
  field: {
    label: "Pesquisar ficheiros",
    placeholder: "Pesquisar pelo nome…",
    submit: "Pesquisar",
  },
  idle: "Escreva parte do nome de um ficheiro ou de uma pasta para o encontrar.",
  searching: "A pesquisar…",
  count: (n, q) =>
    isOne("pt-PT", n) ? `${n} resultado para “${q}”` : `${n} resultados para “${q}”`,
  none: {
    title: (q) => `Nada encontrado para “${q}”`,
    hint: "Verifique a ortografia ou experimente uma parte mais curta do nome.",
  },
  limited: (n) =>
    `A mostrar as primeiras ${n} correspondências. Escreva mais do nome para as reduzir.`,
  caption: (q) => `Resultados para ${q}`,
  location: "Localização",
  pathLabel: (name) => `Onde está ${name}`,
  preview: {
    controls: "Controlos da pré-visualização",
    previous: "Ficheiro anterior",
    next: "Ficheiro seguinte",
    position: (n, total) => `${n} de ${total}`,
    download: "Descarregar",
    loading: "A carregar a pré-visualização…",
    truncated: (shown, total) =>
      `A mostrar os primeiros ${shown} de ${total}. Descarregue o ficheiro para o ler por inteiro.`,
    empty: "Este ficheiro está vazio.",
    unavailable: "Este tipo de ficheiro não pode ser mostrado aqui. Pode descarregá-lo.",
  },
};
