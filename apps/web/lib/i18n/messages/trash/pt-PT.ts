import { isOne } from "../../plural";
import type { Trash } from "./en";

export const ptPT: Trash = {
  title: "Reciclagem",
  loading: "A obter a reciclagem…",
  caption: "Itens na reciclagem",
  name: "Nome",
  size: "Tamanho",
  trashed: "Movido para a reciclagem",
  actions: "Ações",
  folder: "Pasta",
  empty: {
    title: "A reciclagem está vazia",
    hint: "Os itens que mover para a reciclagem aguardam aqui antes de serem eliminados definitivamente.",
  },
  retention: (days) =>
    isOne("pt-PT", days)
      ? `Os itens ficam ${days} dia na reciclagem e depois são eliminados definitivamente.`
      : `Os itens ficam ${days} dias na reciclagem e depois são eliminados definitivamente.`,
  restore: "Restaurar",
  restoreLabel: (name) => `Restaurar ${name}`,
  deleteForever: "Eliminar definitivamente",
  deleteForeverLabel: (name) => `Eliminar ${name} definitivamente`,
  emptyTrash: "Esvaziar a reciclagem",
  confirm: {
    cancel: "Cancelar",
    deleteTitle: "Eliminar definitivamente?",
    deleteBody: (name) =>
      `${name} e tudo o que contém serão eliminados definitivamente. Não pode ser anulado.`,
    deleteSubmit: "Eliminar definitivamente",
    deleting: "A eliminar…",
    emptyTitle: "Esvaziar a reciclagem?",
    emptyBody: (n) =>
      isOne("pt-PT", n)
        ? `${n} item será eliminado definitivamente. Não pode ser anulado.`
        : `${n} itens serão eliminados definitivamente. Não pode ser anulado.`,
    emptySubmit: "Esvaziar a reciclagem",
    emptying: "A esvaziar…",
  },
  notices: {
    restored: (name) => `${name} foi restaurado`,
    deleted: (name) => `${name} foi eliminado definitivamente`,
    emptied: "A reciclagem está agora vazia.",
  },
};
