import { isOne } from "../../plural";
import type { Photos } from "./en";

export const ptPT: Photos = {
  nav: "Fotografias",
  title: "Fotografias",
  loading: "A obter as suas fotografias…",
  loadingMore: "A obter mais fotografias…",
  count: (n) => (isOne("pt-PT", n) ? `${n} fotografia` : `${n} fotografias`),
  countSoFar: (n) =>
    isOne("pt-PT", n) ? `${n} fotografia até agora` : `${n} fotografias até agora`,
  loadMore: "Obter mais",
  cancel: "Cancelar",
  video: "Vídeo",
  empty: {
    title: "Ainda não há fotografias",
    hint: "As imagens e os vídeos que carregar para os seus ficheiros aparecem aqui, os mais recentes primeiro.",
  },
  toolbar: {
    label: "Ações das fotografias",
    albums: "Álbuns",
  },
  select: {
    start: "Selecionar fotografias",
    cancel: "Cancelar seleção",
    count: (n) => (isOne("pt-PT", n) ? `${n} selecionada` : `${n} selecionadas`),
    label: (name) => `Selecionar ${name}`,
    addToAlbum: "Adicionar a um álbum…",
  },
  lightbox: {
    close: "Fechar",
    previous: "Fotografia anterior",
    next: "Fotografia seguinte",
    position: (n, total) => `${n} de ${total}`,
    taken: (date) => `Tirada em ${date}`,
    uploaded: (date) => `Data de carregamento: ${date}`,
    openOriginal: "Abrir o original",
    noPreview: "Não está disponível uma pré-visualização deste ficheiro.",
  },
  addDialog: {
    title: (n) =>
      isOne("pt-PT", n)
        ? `Adicionar ${n} fotografia a um álbum`
        : `Adicionar ${n} fotografias a um álbum`,
    loading: "A obter os seus álbuns…",
    existing: "Os seus álbuns",
    none: "Ainda não tem álbuns. Crie o primeiro aqui em baixo.",
    newLabel: "Nome de um novo álbum",
    create: "Criar álbum e adicionar",
    creating: "A criar…",
    adding: "A adicionar…",
    required: "Introduza um nome para o álbum.",
  },
  albums: {
    title: "Álbuns",
    loading: "A obter os seus álbuns…",
    back: "Todos os álbuns",
    listLabel: "Os seus álbuns",
    toolbarLabel: "Ações do álbum",
    photos: (n) => (isOne("pt-PT", n) ? `${n} fotografia` : `${n} fotografias`),
    empty: {
      title: "Ainda não há álbuns",
      hint: "Escolha Selecionar fotografias na sua cronologia e adicione-as a um álbum.",
    },
    emptyAlbum: {
      title: "Este álbum está vazio",
      hint: "Escolha Selecionar fotografias na sua cronologia e adicione-as a este álbum.",
    },
    new: "Novo álbum",
    newDialog: {
      title: "Novo álbum",
      label: "Nome do álbum",
      submit: "Criar álbum",
      submitting: "A criar…",
      required: "Introduza um nome para o álbum.",
    },
    rename: "Mudar o nome",
    renameLabel: (name) => `Mudar o nome de ${name}`,
    renameDialog: {
      title: (name) => `Mudar o nome de ${name}`,
      label: "Nome do álbum",
      submit: "Mudar o nome",
      submitting: "A mudar o nome…",
      required: "Introduza um nome para o álbum.",
    },
    delete: "Eliminar",
    deleteLabel: (name) => `Eliminar ${name}`,
    deleteAlbum: "Eliminar álbum",
    confirm: {
      title: "Eliminar este álbum?",
      body: (name) =>
        `${name} será eliminado. As fotografias que contém continuam nos seus ficheiros.`,
      submit: "Eliminar álbum",
      deleting: "A eliminar…",
    },
    remove: "Retirar do álbum",
  },
  notices: {
    added: (n, album) =>
      isOne("pt-PT", n)
        ? `${n} fotografia adicionada a ${album}`
        : `${n} fotografias adicionadas a ${album}`,
    created: (name) => `O álbum ${name} foi criado`,
    deleted: (name) => `O álbum ${name} foi eliminado`,
    renamed: (name) => `O álbum passou a chamar-se ${name}`,
    removed: (n, album) =>
      isOne("pt-PT", n)
        ? `${n} fotografia retirada de ${album}`
        : `${n} fotografias retiradas de ${album}`,
  },
};
