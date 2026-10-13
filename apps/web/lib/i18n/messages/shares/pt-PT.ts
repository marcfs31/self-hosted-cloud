import type { Shares } from "./en";

export const ptPT: Shares = {
  title: "Ligações partilhadas",
  menuShare: "Partilhar…",
  loading: "A obter as suas ligações partilhadas…",
  caption: "As suas ligações partilhadas",
  intro:
    "Quem tiver uma destas ligações pode abrir o que ela partilha. Uma ligação só é mostrada uma vez, quando a cria.",
  columns: {
    item: "Item",
    kind: "Tipo",
    dropBox: "Caixa de entrega",
    password: "Palavra-passe",
    created: "Criada",
    expires: "Expira",
    actions: "Ações",
  },
  kind: {
    file: "Ficheiro",
    folder: "Pasta",
  },
  yes: "Sim",
  no: "Não",
  never: "Nunca",
  expired: (date) => `${date} (expirada)`,
  empty: {
    title: "Ainda não partilhou nada",
    hint: "Escolha Partilhar… no menu de um ficheiro ou de uma pasta para criar uma ligação.",
  },
  revoke: "Revogar",
  revokeLabel: (name) => `Revogar a ligação para ${name}`,
  confirm: {
    title: "Revogar esta ligação?",
    body: (name) =>
      `Quem tiver a ligação para ${name} perde o acesso de imediato. Não pode ser anulado.`,
    cancel: "Cancelar",
    submit: "Revogar ligação",
    submitting: "A revogar…",
  },
  notices: {
    revoked: (name) => `A ligação para ${name} foi revogada`,
  },
  password: {
    show: "Mostrar palavra-passe",
    hide: "Ocultar palavra-passe",
  },
  share: {
    title: (name) => `Partilhar ${name}`,
    expiryLabel: "A ligação expira",
    expiry: {
      "1": "Após 1 dia",
      "7": "Após 7 dias",
      "30": "Após 30 dias",
      "365": "Após 1 ano",
      never: "Nunca",
    },
    passwordLabel: "Palavra-passe (opcional)",
    passwordHint: "Pelo menos 8 caracteres. Envie-a separadamente da ligação.",
    passwordTooShort: "Use pelo menos 8 caracteres ou deixe a palavra-passe vazia.",
    dropBox:
      "Permitir que as pessoas carreguem ficheiros (caixa de entrega — não veem o conteúdo da pasta)",
    submit: "Criar ligação",
    submitting: "A criar…",
    cancel: "Cancelar",
    created: {
      title: "A sua ligação está pronta",
      linkLabel: "Ligação",
      copy: "Copiar ligação",
      copied: "Ligação copiada.",
      copyFailed: "Não foi possível copiar automaticamente. Selecione a ligação e copie-a.",
      once: "Esta é a única vez que a ligação é mostrada. Copie-a agora; se a perder, crie uma nova.",
      expires: (date) => `Funciona até ${date}.`,
      neverExpires: "Funciona até a revogar.",
      protected: "As pessoas vão precisar da palavra-passe para a abrir.",
      manage: "Pode revogá-la a qualquer momento na página Ligações partilhadas.",
      done: "Concluído",
    },
  },
  public: {
    pageTitle: "Ligação partilhada",
    loading: "A abrir a ligação…",
    expiresOn: (date) => `Esta ligação funciona até ${date}.`,
    notFound: {
      title: "Esta ligação não funciona",
      body: "Pode ter expirado, ter sido removida por quem a criou ou ter sido escrita incorretamente. Peça uma nova ligação a quem lha enviou.",
    },
    locked: {
      title: "Esta ligação está protegida",
      body: "Introduza a palavra-passe que lhe foi dada para a abrir.",
      label: "Palavra-passe",
      submit: "Abrir",
      submitting: "A verificar…",
      wrong: "Essa palavra-passe não está certa. Tente novamente.",
    },
    file: {
      size: (size) => `Tamanho: ${size}`,
      download: "Descarregar",
    },
    folder: {
      caption: (folder) => `Conteúdo de ${folder}`,
      empty: "Esta pasta não tem nada.",
      download: "Descarregar",
      downloadLabel: (name) => `Descarregar ${name}`,
      downloadAll: "Descarregar tudo (.zip)",
    },
    dropbox: {
      title: (name) => `Enviar ficheiros para ${name}`,
      intro:
        "Os seus ficheiros vão diretamente para a pasta. Não vai ver o que lá está, nem ninguém que tenha esta ligação.",
      choose: "Escolher ficheiros",
      dropHint: "ou largue os ficheiros aqui",
      dropActive: "Largue os ficheiros para os enviar",
      full: "Estes ficheiros não cabem: o armazenamento de quem os recebe está cheio.",
      gone: "Esta caixa de entrega foi fechada. Peça uma nova ligação a quem a partilhou.",
    },
  },
};
