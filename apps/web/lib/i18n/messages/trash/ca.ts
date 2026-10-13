import { isOne } from "../../plural";
import type { Trash } from "./en";

export const ca: Trash = {
  title: "Paperera",
  loading: "Carregant la paperera…",
  caption: "Elements de la paperera",
  name: "Nom",
  size: "Mida",
  trashed: "Mogut a la paperera",
  actions: "Accions",
  folder: "Carpeta",
  empty: {
    title: "La paperera és buida",
    hint: "Els elements que moguis a la paperera esperen aquí abans d'eliminar-se per sempre.",
  },
  retention: (days) =>
    isOne("ca", days)
      ? `Els elements es queden ${days} dia a la paperera i després s'eliminen per sempre.`
      : `Els elements es queden ${days} dies a la paperera i després s'eliminen per sempre.`,
  restore: "Restaura",
  restoreLabel: (name) => `Restaura ${name}`,
  deleteForever: "Elimina per sempre",
  deleteForeverLabel: (name) => `Elimina ${name} per sempre`,
  emptyTrash: "Buida la paperera",
  confirm: {
    cancel: "Cancel·la",
    deleteTitle: "Vols eliminar-ho per sempre?",
    deleteBody: (name) => `${name} i tot el que conté s'eliminaran per sempre. No es pot desfer.`,
    deleteSubmit: "Elimina per sempre",
    deleting: "Eliminant…",
    emptyTitle: "Vols buidar la paperera?",
    emptyBody: (n) =>
      isOne("ca", n)
        ? `S'eliminarà ${n} element per sempre. No es pot desfer.`
        : `S'eliminaran ${n} elements per sempre. No es pot desfer.`,
    emptySubmit: "Buida la paperera",
    emptying: "Buidant…",
  },
  notices: {
    restored: (name) => `S'ha restaurat ${name}`,
    deleted: (name) => `S'ha eliminat ${name} per sempre`,
    emptied: "La paperera ja és buida.",
  },
};
