import { isOne } from "../../plural";
import type { Trash } from "./en";

export const es: Trash = {
  title: "Papelera",
  loading: "Cargando la papelera…",
  caption: "Elementos de la papelera",
  name: "Nombre",
  size: "Tamaño",
  trashed: "Movido a la papelera",
  actions: "Acciones",
  folder: "Carpeta",
  empty: {
    title: "La papelera está vacía",
    hint: "Los elementos que muevas a la papelera esperan aquí antes de eliminarse para siempre.",
  },
  retention: (days) =>
    isOne("es", days)
      ? `Los elementos permanecen ${days} día en la papelera y después se eliminan para siempre.`
      : `Los elementos permanecen ${days} días en la papelera y después se eliminan para siempre.`,
  restore: "Restaurar",
  restoreLabel: (name) => `Restaurar ${name}`,
  deleteForever: "Eliminar para siempre",
  deleteForeverLabel: (name) => `Eliminar ${name} para siempre`,
  emptyTrash: "Vaciar la papelera",
  confirm: {
    cancel: "Cancelar",
    deleteTitle: "¿Eliminar para siempre?",
    deleteBody: (name) =>
      `${name} y todo su contenido se eliminarán para siempre. No se puede deshacer.`,
    deleteSubmit: "Eliminar para siempre",
    deleting: "Eliminando…",
    emptyTitle: "¿Vaciar la papelera?",
    emptyBody: (n) =>
      isOne("es", n)
        ? `Se eliminará ${n} elemento para siempre. No se puede deshacer.`
        : `Se eliminarán ${n} elementos para siempre. No se puede deshacer.`,
    emptySubmit: "Vaciar la papelera",
    emptying: "Vaciando…",
  },
  notices: {
    restored: (name) => `Se ha restaurado ${name}`,
    deleted: (name) => `Se ha eliminado ${name} para siempre`,
    emptied: "La papelera está vacía.",
  },
};
