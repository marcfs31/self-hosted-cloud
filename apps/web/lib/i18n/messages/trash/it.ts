import { isOne } from "../../plural";
import type { Trash } from "./en";

export const it: Trash = {
  title: "Cestino",
  loading: "Caricamento del cestino…",
  caption: "Elementi nel cestino",
  name: "Nome",
  size: "Dimensione",
  trashed: "Spostato nel cestino",
  actions: "Azioni",
  folder: "Cartella",
  empty: {
    title: "Il cestino è vuoto",
    hint: "Gli elementi che sposti nel cestino restano qui prima di essere eliminati definitivamente.",
  },
  retention: (days) =>
    isOne("it", days)
      ? `Gli elementi restano nel cestino per ${days} giorno, poi vengono eliminati definitivamente.`
      : `Gli elementi restano nel cestino per ${days} giorni, poi vengono eliminati definitivamente.`,
  restore: "Ripristina",
  restoreLabel: (name) => `Ripristina ${name}`,
  deleteForever: "Elimina definitivamente",
  deleteForeverLabel: (name) => `Elimina ${name} definitivamente`,
  emptyTrash: "Svuota il cestino",
  confirm: {
    cancel: "Annulla",
    deleteTitle: "Eliminare definitivamente?",
    deleteBody: (name) =>
      `${name} e tutto ciò che contiene verranno eliminati definitivamente. Non si può annullare.`,
    deleteSubmit: "Elimina definitivamente",
    deleting: "Eliminazione…",
    emptyTitle: "Svuotare il cestino?",
    emptyBody: (n) =>
      isOne("it", n)
        ? `${n} elemento verrà eliminato definitivamente. Non si può annullare.`
        : `${n} elementi verranno eliminati definitivamente. Non si può annullare.`,
    emptySubmit: "Svuota il cestino",
    emptying: "Svuotamento…",
  },
  notices: {
    restored: (name) => `${name} ripristinato`,
    deleted: (name) => `${name} eliminato definitivamente`,
    emptied: "Ora il cestino è vuoto.",
  },
};
