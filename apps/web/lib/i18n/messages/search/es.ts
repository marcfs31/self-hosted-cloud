import { isOne } from "../../plural";
import type { Search } from "./en";

export const es: Search = {
  title: "Búsqueda",
  field: {
    label: "Buscar archivos",
    placeholder: "Buscar por nombre…",
    submit: "Buscar",
  },
  idle: "Escribe parte del nombre de un archivo o carpeta para encontrarlo.",
  searching: "Buscando…",
  count: (n, q) => (isOne("es", n) ? `${n} resultado para “${q}”` : `${n} resultados para “${q}”`),
  none: {
    title: (q) => `No se encontró nada para “${q}”`,
    hint: "Revisa la ortografía o prueba con una parte más corta del nombre.",
  },
  limited: (n) =>
    `Se muestran las primeras ${n} coincidencias. Escribe más del nombre para acotarlas.`,
  caption: (q) => `Resultados para ${q}`,
  location: "Ubicación",
  pathLabel: (name) => `Dónde está ${name}`,
  preview: {
    controls: "Controles de la vista previa",
    previous: "Archivo anterior",
    next: "Archivo siguiente",
    position: (n, total) => `${n} de ${total}`,
    download: "Descargar",
    loading: "Cargando la vista previa…",
    truncated: (shown, total) =>
      `Se muestran los primeros ${shown} de ${total}. Descarga el archivo para leerlo entero.`,
    empty: "Este archivo está vacío.",
    unavailable: "Este tipo de archivo no se puede mostrar aquí. Puedes descargarlo.",
  },
};
