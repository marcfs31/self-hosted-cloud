import type { System } from "./en";

export const es: System = {
  title: "Sistema",
  adminLink: "Estado del sistema",
  adminLinkNote: "Cómo van el servidor, el almacenamiento y las copias de seguridad.",
  refresh: "Actualizar",
  refreshing: "Actualizando…",
  loading: "Cargando el estado del sistema…",
  lastUpdated: (time) => `Actualizado a las ${time}`,
  updatedNotice: "Estado actualizado",
  autoRefresh: "Se actualiza solo cada 30 segundos mientras esta pestaña esté visible.",
  outdatedBadge: "Desactualizado",
  refreshFailed: (time) =>
    `No se pudo actualizar el estado. Estás viendo lo que informó el servidor a las ${time}.`,
  unknown: "Desconocido",
  server: {
    title: "Este servidor",
    version: "Versión",
    uptime: "Encendido desde hace",
    cores: "Núcleos del procesador",
    load: "Carga media (1 / 5 / 15 min)",
    temperature: "Temperatura",
  },
  memory: {
    title: "Memoria",
    label: "Memoria en uso",
    usedOf: (used, total) => `${used} de ${total}`,
    available: (value) => `${value} disponibles`,
  },
  storage: {
    title: "Almacenamiento",
    label: "Almacenamiento usado en /data",
    usedOf: (used, total) => `${used} de ${total}`,
    free: (value) => `${value} libres`,
    unknown: "Desconocido. El servidor no pudo leer el disco.",
  },
  checks: {
    title: "Comprobaciones del anfitrión",
    intro: "Las tareas programadas en el anfitrión informan aquí de sus resultados.",
    backup: "Copia de seguridad",
    restoreTest: "Prueba de restauración",
    health: "Salud",
    state: {
      ok: "Correcto",
      failing: "Con fallos",
      stale: "Atrasado",
      unknown: "Desconocido",
    },
    checked: (relative, exact) => `Comprobado ${relative} (${exact})`,
    neverReported: "Nunca ha informado",
    help: {
      failing:
        "La última ejecución informó de un problema. Consulta el registro en el anfitrión para ver por qué.",
      stale: (age) =>
        `El anfitrión no informa desde hace ${age}. Comprueba que su temporizador de systemd sigue funcionando.`,
      unknown:
        "El anfitrión nunca envió un informe o no se pudo leer. Comprueba que el temporizador de systemd está instalado y se ha ejecutado.",
    },
    noFacts: "No se informó de ningún detalle.",
    facts: {
      endpoint: "Punto de comprobación de salud (estado HTTP)",
      freePercent: "Espacio libre (%)",
      smart: "Estado SMART",
      repositories: "Repositorios",
      failedRepositories: "Repositorios con fallos",
      snapshot: "Instantánea de la base de datos",
      integrity: "Integridad",
      files: "Archivos restaurados / listados",
    },
  },
};
