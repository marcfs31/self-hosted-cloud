import { isOne } from "../../plural";
import type { Photos } from "./en";

export const ca: Photos = {
  nav: "Fotos",
  title: "Fotos",
  loading: "Carregant les teves fotos…",
  loadingMore: "Carregant més fotos…",
  count: (n) => (isOne("ca", n) ? `${n} foto` : `${n} fotos`),
  countSoFar: (n) => (isOne("ca", n) ? `${n} foto fins ara` : `${n} fotos fins ara`),
  loadMore: "Carrega'n més",
  cancel: "Cancel·la",
  video: "Vídeo",
  empty: {
    title: "Encara no hi ha fotos",
    hint: "Les imatges i els vídeos que pugis als teus fitxers apareixen aquí, els més recents primer.",
  },
  toolbar: {
    label: "Accions de fotos",
    albums: "Àlbums",
  },
  select: {
    start: "Selecciona fotos",
    cancel: "Cancel·la la selecció",
    count: (n) => (isOne("ca", n) ? `${n} seleccionada` : `${n} seleccionades`),
    label: (name) => `Selecciona ${name}`,
    addToAlbum: "Afegeix a un àlbum…",
  },
  lightbox: {
    close: "Tanca",
    previous: "Foto anterior",
    next: "Foto següent",
    position: (n, total) => `${n} de ${total}`,
    taken: (date) => `Presa el ${date}`,
    uploaded: (date) => `Data de pujada: ${date}`,
    openOriginal: "Obre l'original",
    noPreview: "No hi ha cap vista prèvia disponible per a aquest fitxer.",
  },
  addDialog: {
    title: (n) =>
      isOne("ca", n) ? `Afegeix ${n} foto a un àlbum` : `Afegeix ${n} fotos a un àlbum`,
    loading: "Carregant els teus àlbums…",
    existing: "Els teus àlbums",
    none: "Encara no tens cap àlbum. Crea'n el primer aquí sota.",
    newLabel: "Nom d'un àlbum nou",
    create: "Crea l'àlbum i afegeix-hi les fotos",
    creating: "Creant…",
    adding: "Afegint…",
    required: "Escriu un nom per a l'àlbum.",
  },
  albums: {
    title: "Àlbums",
    loading: "Carregant els teus àlbums…",
    back: "Tots els àlbums",
    listLabel: "Els teus àlbums",
    toolbarLabel: "Accions de l'àlbum",
    photos: (n) => (isOne("ca", n) ? `${n} foto` : `${n} fotos`),
    empty: {
      title: "Encara no hi ha àlbums",
      hint: "Tria Selecciona fotos a la teva cronologia i afegeix-les a un àlbum.",
    },
    emptyAlbum: {
      title: "Aquest àlbum és buit",
      hint: "Tria Selecciona fotos a la teva cronologia i afegeix-les a aquest àlbum.",
    },
    new: "Àlbum nou",
    newDialog: {
      title: "Àlbum nou",
      label: "Nom de l'àlbum",
      submit: "Crea l'àlbum",
      submitting: "Creant…",
      required: "Escriu un nom per a l'àlbum.",
    },
    rename: "Canvia el nom",
    renameLabel: (name) => `Canvia el nom de ${name}`,
    renameDialog: {
      title: (name) => `Canvia el nom de ${name}`,
      label: "Nom de l'àlbum",
      submit: "Canvia el nom",
      submitting: "Canviant el nom…",
      required: "Escriu un nom per a l'àlbum.",
    },
    delete: "Elimina",
    deleteLabel: (name) => `Elimina ${name}`,
    deleteAlbum: "Elimina l'àlbum",
    confirm: {
      title: "Vols eliminar aquest àlbum?",
      body: (name) => `${name} s'eliminarà. Les fotos que conté continuen als teus fitxers.`,
      submit: "Elimina l'àlbum",
      deleting: "Eliminant…",
    },
    remove: "Treu de l'àlbum",
  },
  notices: {
    added: (n, album) =>
      isOne("ca", n) ? `S'ha afegit ${n} foto a ${album}` : `S'han afegit ${n} fotos a ${album}`,
    created: (name) => `S'ha creat l'àlbum ${name}`,
    deleted: (name) => `S'ha eliminat l'àlbum ${name}`,
    renamed: (name) => `L'àlbum s'ha reanomenat a ${name}`,
    removed: (n, album) =>
      isOne("ca", n) ? `S'ha tret ${n} foto de ${album}` : `S'han tret ${n} fotos de ${album}`,
  },
};
