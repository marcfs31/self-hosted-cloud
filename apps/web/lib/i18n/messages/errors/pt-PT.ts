import type { Errors } from "./en";

export const ptPT: Errors = {
  invalid_request: "Alguns dados não parecem estar corretos. Verifique-os e tente novamente.",
  unauthenticated: "A sua sessão terminou. Inicie sessão novamente.",
  not_found: "Não encontrámos o que procura. Pode ter sido removido.",
  origin_rejected:
    "Este pedido não veio da página esperada. Recarregue a página e tente novamente.",
  too_many_attempts: "Demasiadas tentativas por agora. Aguarde alguns minutos e tente novamente.",
  setup_already_done: "Esta cloud já está configurada. Inicie sessão.",
  invalid_credentials: "O e-mail e a palavra-passe não correspondem. Tente novamente.",
  invite_invalid: "Esta ligação de convite já não é válida. Peça uma nova à administração.",
  email_taken: "Já existe uma conta com esse e-mail.",
  cannot_change_self: "Não pode alterar a sua própria conta aqui.",
  internal: "Algo correu mal do nosso lado. Tente novamente dentro de instantes.",
};
