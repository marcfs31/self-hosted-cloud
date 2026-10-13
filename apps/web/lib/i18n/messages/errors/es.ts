import type { Errors } from "./en";

export const es: Errors = {
  invalid_request: "Algunos datos no parecen correctos. Revísalos e inténtalo de nuevo.",
  unauthenticated: "Tu sesión ha terminado. Inicia sesión de nuevo.",
  not_found: "No hemos encontrado lo que buscas. Puede que se haya eliminado.",
  origin_rejected:
    "Esta solicitud no procede de la página esperada. Recarga la página e inténtalo de nuevo.",
  too_many_attempts: "Demasiados intentos por ahora. Espera unos minutos e inténtalo de nuevo.",
  setup_already_done: "Esta nube ya está configurada. Inicia sesión.",
  invalid_credentials: "El correo electrónico y la contraseña no coinciden. Inténtalo de nuevo.",
  invite_invalid:
    "Este enlace de invitación ya no es válido. Pide uno nuevo a quien administra la nube.",
  email_taken: "Ya existe una cuenta con ese correo electrónico.",
  cannot_change_self: "No puedes cambiar tu propia cuenta desde aquí.",
  name_conflict: "Ya hay un elemento con ese nombre aquí. Elige otro nombre.",
  invalid_move: "Ese elemento no se puede mover ni cambiar de esta forma.",
  quota_exceeded: "No queda espacio suficiente en tu almacenamiento para esto.",
  version_is_current: "Esta es la versión actual. Restaura otra versión primero.",
  thumbnail_unavailable: "No hay vista previa disponible para este archivo.",
  share_locked: "Este enlace está protegido. Escribe la contraseña para abrirlo.",
  internal: "Algo ha salido mal por nuestra parte. Inténtalo de nuevo en un momento.",
};
