import type { Shares } from "./en";

export const es: Shares = {
  title: "Enlaces compartidos",
  menuShare: "Compartir…",
  loading: "Cargando tus enlaces compartidos…",
  caption: "Tus enlaces compartidos",
  intro:
    "Quien tenga uno de estos enlaces puede abrir lo que comparte. Un enlace se muestra una sola vez, cuando lo creas.",
  columns: {
    item: "Elemento",
    kind: "Tipo",
    dropBox: "Buzón de entrega",
    password: "Contraseña",
    created: "Creado",
    expires: "Caduca",
    actions: "Acciones",
  },
  kind: {
    file: "Archivo",
    folder: "Carpeta",
  },
  yes: "Sí",
  no: "No",
  never: "Nunca",
  expired: (date) => `${date} (caducado)`,
  empty: {
    title: "Todavía no has compartido nada",
    hint: "Elige Compartir… en el menú de un archivo o una carpeta para crear un enlace.",
  },
  revoke: "Revocar",
  revokeLabel: (name) => `Revocar el enlace a ${name}`,
  confirm: {
    title: "¿Revocar este enlace?",
    body: (name) =>
      `Quien tenga el enlace a ${name} perderá el acceso de inmediato. No se puede deshacer.`,
    cancel: "Cancelar",
    submit: "Revocar enlace",
    submitting: "Revocando…",
  },
  notices: {
    revoked: (name) => `Se ha revocado el enlace a ${name}`,
  },
  password: {
    show: "Mostrar contraseña",
    hide: "Ocultar contraseña",
  },
  share: {
    title: (name) => `Compartir ${name}`,
    expiryLabel: "El enlace caduca",
    expiry: {
      "1": "Tras 1 día",
      "7": "Tras 7 días",
      "30": "Tras 30 días",
      "365": "Tras 1 año",
      never: "Nunca",
    },
    passwordLabel: "Contraseña (opcional)",
    passwordHint: "Al menos 8 caracteres. Envíala por separado del enlace.",
    passwordTooShort: "Usa al menos 8 caracteres o deja la contraseña vacía.",
    dropBox:
      "Permitir que otras personas suban archivos (buzón de entrega: no ven el contenido de la carpeta)",
    submit: "Crear enlace",
    submitting: "Creando…",
    cancel: "Cancelar",
    created: {
      title: "Tu enlace está listo",
      linkLabel: "Enlace",
      copy: "Copiar enlace",
      copied: "Enlace copiado.",
      copyFailed: "No se ha podido copiar automáticamente. Selecciona el enlace y cópialo tú.",
      once: "Esta es la única vez que se muestra el enlace. Cópialo ahora; si lo pierdes, crea uno nuevo.",
      expires: (date) => `Funciona hasta el ${date}.`,
      neverExpires: "Funciona hasta que lo revoques.",
      protected: "Las personas necesitarán la contraseña para abrirlo.",
      manage: "Puedes revocarlo cuando quieras en la página Enlaces compartidos.",
      done: "Listo",
    },
  },
  public: {
    pageTitle: "Enlace compartido",
    loading: "Abriendo el enlace…",
    expiresOn: (date) => `Este enlace funciona hasta el ${date}.`,
    notFound: {
      title: "Este enlace no funciona",
      body: "Puede que haya caducado, que su propietario lo haya quitado o que esté mal escrito. Pide un enlace nuevo a quien te lo envió.",
    },
    locked: {
      title: "Este enlace está protegido",
      body: "Escribe la contraseña que te dieron para abrirlo.",
      label: "Contraseña",
      submit: "Abrir",
      submitting: "Comprobando…",
      wrong: "Esa contraseña no es correcta. Inténtalo de nuevo.",
    },
    file: {
      size: (size) => `Tamaño: ${size}`,
      download: "Descargar",
    },
    folder: {
      caption: (folder) => `Contenido de ${folder}`,
      empty: "No hay nada en esta carpeta.",
      download: "Descargar",
      downloadLabel: (name) => `Descargar ${name}`,
      downloadAll: "Descargar todo (.zip)",
    },
    dropbox: {
      title: (name) => `Enviar archivos a ${name}`,
      intro:
        "Tus archivos van directamente a la carpeta. No verás lo que hay dentro, ni nadie más con este enlace.",
      choose: "Elegir archivos",
      dropHint: "o suelta los archivos aquí",
      dropActive: "Suelta los archivos para enviarlos",
      full: "Estos archivos no caben: el almacenamiento de quien los recibe está lleno.",
      gone: "Este buzón de entrega se ha cerrado. Pide un enlace nuevo a quien lo compartió.",
    },
  },
};
