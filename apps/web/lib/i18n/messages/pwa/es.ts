import { isOne } from "../../plural";
import type { Pwa } from "./en";

export const es: Pwa = {
  nav: { backup: "Copia del móvil" },
  install: {
    region: "Instalar la aplicación",
    text: "Instala Cloud en este dispositivo para abrirlo como cualquier otra aplicación.",
    button: "Instalar aplicación",
    dismiss: "Ahora no",
  },
  ios: {
    region: "Instalar la aplicación",
    text: "Para instalar Cloud en este dispositivo, toca el botón Compartir y elige Añadir a pantalla de inicio.",
    dismiss: "Entendido",
  },
  update: { text: "Actualización disponible", reload: "Recargar" },
  offline: {
    title: "No se puede acceder a Cloud",
    body: "Parece que no tienes conexión o que el servidor no responde. Tus archivos están a salvo y volverán a aparecer en cuanto te conectes.",
    retry: "Reintentar",
  },
  picker: {
    hint: "Abre una carpeta para ver su contenido y elige la que quieras.",
    target: (folder) => `Carpeta seleccionada: ${folder}`,
    submit: "Usar esta carpeta",
  },
  share: {
    title: "Compartido con Cloud",
    loading: "Buscando los archivos compartidos…",
    unsupported:
      "Este navegador no puede entregar archivos compartidos a Cloud. Usa Subir en tus archivos.",
    empty: {
      title: "No hay nada que subir aquí",
      hint: "Comparte fotos o archivos con Cloud desde otra aplicación y aparecerán aquí.",
      back: "Volver a los archivos",
    },
    listLabel: "Archivos compartidos",
    count: (n) =>
      isOne("es", n) ? `${n} archivo listo para subir` : `${n} archivos listos para subir`,
    destination: (folder) => `Subir a: ${folder}`,
    chooseFolder: "Elegir otra carpeta",
    pickerTitle: "Elige dónde subir",
    upload: "Subir",
    uploading: "Subiendo. El progreso se muestra en el panel de subidas.",
    discard: "Descartar",
    discarded: "Se descartaron los archivos compartidos.",
    finished: (n, folder) =>
      isOne("es", n)
        ? `Se subió ${n} archivo a ${folder}.`
        : `Se subieron ${n} archivos a ${folder}.`,
    withFailures: (done, failed) =>
      `${done} subidos, ${failed} con error. Puedes reintentar los fallidos en el panel de subidas.`,
    openFolder: "Abrir la carpeta",
  },
  backup: {
    title: "Copia del móvil",
    intro:
      "Elige las fotos y los vídeos de tu móvil y Cloud sube los que aún no tiene. Los archivos que ya están en tu nube se omiten, aunque tengan otro nombre.",
    limits:
      "La copia solo funciona mientras esta página está abierta. Los móviles no permiten que una aplicación web haga copias totalmente automáticas en segundo plano, así que abre esta página de vez en cuando y elige tus fotos nuevas.",
    insecure:
      "La copia del móvil necesita una conexión segura (https) para comprobar tus archivos. Abre Cloud con su dirección https.",
    destinationDefault: (folder) =>
      `Carpeta de la copia: ${folder}, que se crea sola si aún no existe.`,
    destinationChosen: (folder) => `Carpeta de la copia: ${folder}`,
    chooseFolder: "Elegir otra carpeta",
    useDefault: "Usar la carpeta predeterminada",
    pickerTitle: "Elige la carpeta de la copia",
    choose: "Elegir fotos y vídeos",
    take: "Hacer una foto",
    checking: (done, total) => `Comprobando ${done} de ${total}…`,
    uploading: (done, total) => `Subiendo: ${done} de ${total} terminados`,
    summary: (already, uploaded, failed) =>
      `${already} ya tenían copia, ${uploaded} subidos, ${failed} con error`,
    cancelled: (n) => (isOne("es", n) ? `${n} se canceló.` : `${n} se cancelaron.`),
    unchecked: (n) =>
      isOne("es", n)
        ? `${n} archivo grande se subió sin comprobar duplicados (los archivos de más de 512 MiB no se comprueban).`
        : `${n} archivos grandes se subieron sin comprobar duplicados (los archivos de más de 512 MiB no se comprueban).`,
    failedHint: "Puedes reintentar las subidas fallidas en el panel de subidas.",
  },
};
