import { isOne } from "../../plural";
import type { Security } from "./en";

export const es: Security = {
  nav: { settings: "Ajustes" },
  title: "Seguridad",
  intro:
    "Protege tu cuenta con claves de acceso, un segundo paso al iniciar sesión y una contraseña distinta para cada aplicación.",
  activityLink: "Ver tu actividad reciente",
  cancel: "Cancelar",
  login: {
    passkeyButton: "Entrar con una clave de acceso",
    passkeyWaiting: "Esperando tu clave de acceso…",
    passkeyFailed:
      "Esa clave de acceso no ha funcionado. Inténtalo de nuevo o inicia sesión con tu contraseña.",
    divider: "o",
    codeIntro:
      "Escribe el código de 6 dígitos de tu aplicación de autenticación para terminar de iniciar sesión.",
    recoveryIntro:
      "Escribe uno de los códigos de recuperación que guardaste al activar la verificación en dos pasos. Cada código sirve una sola vez.",
    codeLabel: "Código de autenticación",
    recoveryLabel: "Código de recuperación",
    useRecovery: "Usar un código de recuperación",
    useCode: "Usar un código de la aplicación de autenticación",
    submit: "Continuar",
    submitting: "Comprobando…",
    startOver: "Empezar de nuevo",
  },
  passkeys: {
    title: "Claves de acceso",
    intro:
      "Una clave de acceso te permite iniciar sesión con tu huella, tu rostro o el PIN del dispositivo, en lugar de una contraseña. También cuenta como segundo paso.",
    unsupported: "Este navegador no puede crear claves de acceso.",
    caption: "Tus claves de acceso",
    colName: "Nombre",
    colCreated: "Añadida",
    colLastUsed: "Último uso",
    colActions: "Acciones",
    neverUsed: "Nunca",
    empty: "Todavía no has añadido ninguna clave de acceso.",
    loading: "Cargando tus claves de acceso…",
    add: "Añadir una clave de acceso",
    addTitle: "Añadir una clave de acceso",
    nameLabel: "Nombre de esta clave de acceso",
    nameHint: "Algo que te diga dónde está, como «Portátil del trabajo» o «Móvil».",
    nameRequired: "Ponle un nombre a la clave de acceso.",
    continue: "Continuar",
    waiting: "Esperando tu dispositivo…",
    alreadyRegistered: "Este dispositivo ya tiene una clave de acceso para tu cuenta.",
    failed: "No se ha podido crear la clave de acceso. Inténtalo de nuevo o usa otro dispositivo.",
    added: (name) => `Clave de acceso «${name}» añadida.`,
    remove: "Quitar",
    removeLabel: (name) => `Quitar la clave de acceso ${name}`,
    removeTitle: "¿Quitar esta clave de acceso?",
    removeBody: (name) =>
      `Ya no podrás iniciar sesión con «${name}». Podrás volver a añadirla más adelante.`,
    removeSubmit: "Quitar clave de acceso",
    removing: "Quitando…",
    removed: (name) => `Clave de acceso «${name}» quitada.`,
  },
  totp: {
    title: "Verificación en dos pasos",
    intro:
      "Además de tu contraseña, pide un código de una aplicación de autenticación cada vez que inicies sesión.",
    loading: "Cargando…",
    statusOn: "La verificación en dos pasos está activada.",
    statusOff: "La verificación en dos pasos está desactivada.",
    codesLeft: (n) =>
      isOne("es", n)
        ? `Te queda ${n} código de recuperación.`
        : `Te quedan ${n} códigos de recuperación.`,
    codesLow:
      "Te quedan pocos. Si desactivas y vuelves a activar la verificación en dos pasos, obtendrás un conjunto nuevo.",
    setUp: "Configurar",
    settingUp: "Preparando…",
    turnOff: "Desactivar",
    setupTitle: "Configurar la verificación en dos pasos",
    setupIntro:
      "En tu aplicación de autenticación, añade una cuenta nueva e introduce esta clave de configuración. Después escribe el código de 6 dígitos que muestra la aplicación.",
    secretLabel: "Clave de configuración",
    openApp: "Abrir en la aplicación de autenticación",
    openAppNote:
      "En un móvil, este enlace abre directamente tu aplicación de autenticación. En un ordenador, escribe la clave de configuración a mano.",
    codeLabel: "Código de la aplicación",
    codeHint: "Los 6 dígitos que muestra en este momento.",
    codeInvalid: "Escribe los 6 dígitos de tu aplicación de autenticación.",
    turnOn: "Activar",
    turningOn: "Comprobando…",
    enabled:
      "La verificación en dos pasos está activada. Guarda abajo tus códigos de recuperación.",
    recoveryTitle: "Guarda tus códigos de recuperación",
    recoveryIntro:
      "Si pierdes el móvil, cada uno de estos códigos te permite iniciar sesión una vez. No se volverán a mostrar, así que guárdalos en un lugar seguro.",
    recoveryListLabel: "Códigos de recuperación",
    copy: "Copiar códigos",
    copied: "Códigos copiados al portapapeles",
    copyFailed: "No se ha podido copiar automáticamente. Selecciona los códigos y cópialos tú.",
    download: "Descargar .txt",
    fileHeading: "Códigos de recuperación de Cloud. Cada código sirve una sola vez.",
    saved: "Ya los he guardado",
    disableTitle: "¿Desactivar la verificación en dos pasos?",
    disableBody:
      "Para confirmar, escribe tu contraseña y un código de tu aplicación. Un código de recuperación también sirve.",
    passwordLabel: "Contraseña",
    codeOrRecoveryLabel: "Código o código de recuperación",
    disableSubmit: "Desactivar",
    disabling: "Desactivando…",
    disabled: "La verificación en dos pasos está desactivada.",
  },
  appPasswords: {
    title: "Contraseñas de aplicación",
    intro:
      "Da a cada aplicación o dispositivo su propia contraseña para WebDAV, herramientas de línea de comandos y sincronización de escritorio. Puedes revocar una sin cambiar la tuya.",
    caption: "Tus contraseñas de aplicación",
    colName: "Nombre",
    colCreated: "Creada",
    colLastUsed: "Último uso",
    colActions: "Acciones",
    neverUsed: "Nunca",
    empty: "Todavía no has creado ninguna contraseña de aplicación.",
    loading: "Cargando tus contraseñas de aplicación…",
    create: "Crear una contraseña de aplicación",
    createTitle: "Crear una contraseña de aplicación",
    nameLabel: "¿Para qué sirve?",
    nameHint: "Por ejemplo, «Sincronización del móvil» o «Script de copia de seguridad».",
    nameRequired: "Ponle un nombre a la contraseña de aplicación.",
    createSubmit: "Crear",
    creating: "Creando…",
    createdTitle: "Tu nueva contraseña de aplicación",
    createdNote: "Cópiala ahora. No se volverá a mostrar.",
    usageNote:
      "Úsala como contraseña en aplicaciones WebDAV, de línea de comandos o de sincronización de escritorio. Tu propia contraseña sigue siendo privada.",
    tokenLabel: "Contraseña de aplicación",
    copy: "Copiar",
    copied: "Copiada al portapapeles",
    copyFailed:
      "No se ha podido copiar automáticamente. Selecciona la contraseña de aplicación y cópiala tú.",
    dismiss: "Ocultar la contraseña de aplicación",
    revoke: "Revocar",
    revokeLabel: (name) => `Revocar la contraseña de aplicación ${name}`,
    revokeTitle: "¿Revocar esta contraseña de aplicación?",
    revokeBody: (name) => `Todo lo que use «${name}» dejará de funcionar de inmediato.`,
    revokeSubmit: "Revocar",
    revoking: "Revocando…",
    revoked: (name) => `Contraseña de aplicación «${name}» revocada.`,
  },
  stepUp: {
    intro: "Para proteger tu cuenta, confirma que eres tú antes de continuar.",
    loading: "Cargando…",
    passwordRequired: "Introduce tu contraseña.",
    codeLabel: "Código de la aplicación o código de recuperación",
    codeHint:
      "Los 6 dígitos que muestra ahora mismo tu aplicación de autenticación. También sirve un código de recuperación.",
    codeRequired: "Introduce el código de tu aplicación de autenticación.",
    wrongPassword: "Esa contraseña no es correcta. Revísala e inténtalo de nuevo.",
  },
  password: {
    title: "Tu contraseña",
    intro:
      "Elige una contraseña nueva. Seguirás con la sesión iniciada aquí y se cerrará la sesión en todos los demás dispositivos.",
    currentLabel: "Contraseña actual",
    newLabel: "Contraseña nueva",
    submit: "Cambiar contraseña",
    submitting: "Cambiando…",
    done: "Contraseña cambiada. Se cerró la sesión en los demás dispositivos.",
  },
  sessions: {
    title: "Dispositivos con sesión iniciada",
    intro:
      "¿Iniciaste sesión en algún sitio que ya no usas o perdiste un dispositivo? Cierra la sesión en todos los demás. Aquí seguirás con la sesión iniciada.",
    button: "Cerrar sesión en los demás dispositivos",
    confirmTitle: "¿Cerrar sesión en los demás dispositivos?",
    confirmBody:
      "Se cerrará la sesión de inmediato en todos los demás navegadores y dispositivos, y tendrán que volver a pedir tu contraseña. Las contraseñas de aplicación siguen funcionando.",
    confirmSubmit: "Cerrar sesión",
    confirming: "Cerrando sesión…",
    done: "Sesión cerrada en todos los demás dispositivos.",
  },
  admin: {
    resetMfa: "Restablecer la verificación en dos pasos",
    resetMfaFor: (email) => `Restablecer la verificación en dos pasos de ${email}`,
    resetTitle: "¿Restablecer la verificación en dos pasos?",
    resetBody: (email) =>
      `${email} podrá iniciar sesión solo con la contraseña hasta que vuelva a configurar la verificación en dos pasos. Hazlo cuando haya perdido el móvil y los códigos de recuperación.`,
    resetSubmit: "Restablecer",
    resetting: "Restableciendo…",
    resetDone: (email) => `Verificación en dos pasos de ${email} restablecida.`,
    activityTitle: "Actividad de seguridad",
    activityIntro:
      "Inicios de sesión y cambios de seguridad de todas las cuentas, del más reciente al más antiguo.",
  },
};
