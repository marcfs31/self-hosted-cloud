import type { Widen } from "../../types";
import { isOne } from "../../plural";

export const en = {
  nav: "Photos",
  title: "Photos",
  loading: "Loading your photos…",
  loadingMore: "Loading more photos…",
  count: (n: number) => (isOne("en", n) ? `${n} photo` : `${n} photos`),
  countSoFar: (n: number) => (isOne("en", n) ? `${n} photo so far` : `${n} photos so far`),
  loadMore: "Load more",
  cancel: "Cancel",
  video: "Video",
  empty: {
    title: "No photos yet",
    hint: "Pictures and videos you upload to your files show up here, newest first.",
  },
  toolbar: {
    label: "Photo actions",
    albums: "Albums",
  },
  select: {
    start: "Select photos",
    cancel: "Cancel selection",
    count: (n: number) => `${n} selected`,
    label: (name: string) => `Select ${name}`,
    addToAlbum: "Add to album…",
  },
  lightbox: {
    close: "Close",
    previous: "Previous photo",
    next: "Next photo",
    position: (n: number, total: string) => `${n} of ${total}`,
    taken: (date: string) => `Taken: ${date}`,
    uploaded: (date: string) => `Date of upload: ${date}`,
    openOriginal: "Open original",
    noPreview: "A preview isn't available for this file.",
  },
  addDialog: {
    title: (n: number) =>
      isOne("en", n) ? `Add ${n} photo to an album` : `Add ${n} photos to an album`,
    loading: "Loading your albums…",
    existing: "Your albums",
    none: "You don't have any albums yet. Create the first one below.",
    newLabel: "Name of a new album",
    create: "Create album and add",
    creating: "Creating…",
    adding: "Adding…",
    required: "Enter a name for the album.",
  },
  albums: {
    title: "Albums",
    loading: "Loading your albums…",
    back: "All albums",
    listLabel: "Your albums",
    toolbarLabel: "Album actions",
    photos: (n: number) => (isOne("en", n) ? `${n} photo` : `${n} photos`),
    empty: {
      title: "No albums yet",
      hint: "Choose Select photos in your timeline, then add them to an album.",
    },
    emptyAlbum: {
      title: "This album is empty",
      hint: "Choose Select photos in your timeline, then add them to this album.",
    },
    new: "New album",
    newDialog: {
      title: "New album",
      label: "Album name",
      submit: "Create album",
      submitting: "Creating…",
      required: "Enter a name for the album.",
    },
    rename: "Rename",
    renameLabel: (name: string) => `Rename ${name}`,
    renameDialog: {
      title: (name: string) => `Rename ${name}`,
      label: "Album name",
      submit: "Rename",
      submitting: "Renaming…",
      required: "Enter a name for the album.",
    },
    delete: "Delete",
    deleteLabel: (name: string) => `Delete ${name}`,
    deleteAlbum: "Delete album",
    confirm: {
      title: "Delete this album?",
      body: (name: string) => `${name} will be deleted. The photos in it stay in your files.`,
      submit: "Delete album",
      deleting: "Deleting…",
    },
    remove: "Remove from album",
  },
  notices: {
    added: (n: number, album: string) =>
      isOne("en", n) ? `Added ${n} photo to ${album}` : `Added ${n} photos to ${album}`,
    created: (name: string) => `Created the album ${name}`,
    deleted: (name: string) => `Deleted the album ${name}`,
    renamed: (name: string) => `Renamed the album to ${name}`,
    removed: (n: number, album: string) =>
      isOne("en", n) ? `Removed ${n} photo from ${album}` : `Removed ${n} photos from ${album}`,
  },
};

export type Photos = Widen<typeof en>;
