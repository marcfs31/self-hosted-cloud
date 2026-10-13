import { isOne } from "../../plural";
import type { Photos } from "./en";

export const es: Photos = {
  nav: "Fotos",
  title: "Fotos",
  loading: "Cargando tus fotos…",
  loadingMore: "Cargando más fotos…",
  count: (n) => (isOne("es", n) ? `${n} foto` : `${n} fotos`),
  countSoFar: (n) => (isOne("es", n) ? `${n} foto hasta ahora` : `${n} fotos hasta ahora`),
  loadMore: "Cargar más",
  cancel: "Cancelar",
  video: "Vídeo",
  empty: {
    title: "Aún no hay fotos",
    hint: "Las imágenes y los vídeos que subas a tus archivos aparecen aquí, los más recientes primero.",
  },
  toolbar: {
    label: "Acciones de fotos",
    albums: "Álbumes",
  },
  select: {
    start: "Seleccionar fotos",
    cancel: "Cancelar selección",
    count: (n) => (isOne("es", n) ? `${n} seleccionada` : `${n} seleccionadas`),
    label: (name) => `Seleccionar ${name}`,
    addToAlbum: "Añadir a un álbum…",
  },
  lightbox: {
    close: "Cerrar",
    previous: "Foto anterior",
    next: "Foto siguiente",
    position: (n, total) => `${n} de ${total}`,
    taken: (date) => `Tomada el ${date}`,
    uploaded: (date) => `Fecha de subida: ${date}`,
    openOriginal: "Abrir el original",
    noPreview: "No hay vista previa disponible para este archivo.",
  },
  addDialog: {
    title: (n) => (isOne("es", n) ? `Añadir ${n} foto a un álbum` : `Añadir ${n} fotos a un álbum`),
    loading: "Cargando tus álbumes…",
    existing: "Tus álbumes",
    none: "Todavía no tienes álbumes. Crea el primero aquí debajo.",
    newLabel: "Nombre de un álbum nuevo",
    create: "Crear álbum y añadir",
    creating: "Creando…",
    adding: "Añadiendo…",
    required: "Escribe un nombre para el álbum.",
  },
  albums: {
    title: "Álbumes",
    loading: "Cargando tus álbumes…",
    back: "Todos los álbumes",
    listLabel: "Tus álbumes",
    toolbarLabel: "Acciones del álbum",
    photos: (n) => (isOne("es", n) ? `${n} foto` : `${n} fotos`),
    empty: {
      title: "Aún no hay álbumes",
      hint: "Elige Seleccionar fotos en tu cronología y añádelas a un álbum.",
    },
    emptyAlbum: {
      title: "Este álbum está vacío",
      hint: "Elige Seleccionar fotos en tu cronología y añádelas a este álbum.",
    },
    new: "Nuevo álbum",
    newDialog: {
      title: "Nuevo álbum",
      label: "Nombre del álbum",
      submit: "Crear álbum",
      submitting: "Creando…",
      required: "Escribe un nombre para el álbum.",
    },
    rename: "Renombrar",
    renameLabel: (name) => `Renombrar ${name}`,
    renameDialog: {
      title: (name) => `Renombrar ${name}`,
      label: "Nombre del álbum",
      submit: "Renombrar",
      submitting: "Renombrando…",
      required: "Escribe un nombre para el álbum.",
    },
    delete: "Eliminar",
    deleteLabel: (name) => `Eliminar ${name}`,
    deleteAlbum: "Eliminar álbum",
    confirm: {
      title: "¿Eliminar este álbum?",
      body: (name) => `Se eliminará ${name}. Las fotos que contiene siguen en tus archivos.`,
      submit: "Eliminar álbum",
      deleting: "Eliminando…",
    },
    remove: "Quitar del álbum",
  },
  notices: {
    added: (n, album) =>
      isOne("es", n)
        ? `Se ha añadido ${n} foto a ${album}`
        : `Se han añadido ${n} fotos a ${album}`,
    created: (name) => `Se ha creado el álbum ${name}`,
    deleted: (name) => `Se ha eliminado el álbum ${name}`,
    renamed: (name) => `Se ha renombrado el álbum a ${name}`,
    removed: (n, album) =>
      isOne("es", n)
        ? `Se ha quitado ${n} foto de ${album}`
        : `Se han quitado ${n} fotos de ${album}`,
  },
};
