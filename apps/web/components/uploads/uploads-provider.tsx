"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { initialQueue, nextToStart, queueReducer, type UploadItem } from "../../lib/upload-queue";
import { createUpload, type UploadHandle } from "../../lib/uploads";

export interface UploadRequestEntry {
  file: File;
  /** The file this upload adds a version to, or null for a new file. */
  replaceId: string | null;
}

interface UploadsContext {
  items: readonly UploadItem[];
  /** Counts finished uploads, so a listing can refresh when it changes. */
  completed: number;
  /** Returns the queue IDs of the new uploads, in the order of `entries`. */
  enqueue: (entries: readonly UploadRequestEntry[], parentId: string) => string[];
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
}

const Context = createContext<UploadsContext | null>(null);

interface UploadsProviderProps {
  children: ReactNode;
  /**
   * A drop box's tus endpoint. Uploads then go there and name no folder, because the server
   * fixes it; without it they go to the signed-in endpoint, into the folder given to enqueue.
   */
  endpoint?: string;
}

/** Lives above the pages, so an upload keeps running while the person browses elsewhere. */
export function UploadsProvider({ children, endpoint }: UploadsProviderProps) {
  const [state, dispatch] = useReducer(queueReducer, initialQueue);
  const files = useRef(new Map<string, File>());
  const handles = useRef(new Map<string, UploadHandle>());
  const counter = useRef(0);

  // Start queued uploads while there is room.
  useEffect(() => {
    for (const id of nextToStart(state)) {
      const item = state.items.find((i) => i.id === id);
      const file = files.current.get(id);
      if (!item || !file || handles.current.has(id)) {
        continue;
      }
      const handle = createUpload(
        endpoint === undefined
          ? { file, parentId: item.parentId, replaceId: item.replaceId }
          : { file, parentId: null, replaceId: null, endpoint },
        {
          onProgress: (sent) => {
            dispatch({ type: "progress", id, sent });
          },
          onSuccess: (fileId) => {
            dispatch({ type: "succeeded", id, fileId });
          },
          onError: (code) => {
            dispatch({ type: "failed", id, code });
          },
        },
      );
      handles.current.set(id, handle);
      dispatch({ type: "started", id });
      handle.start();
    }
  }, [state, endpoint]);

  // Forget the files and handles of items that were removed from the panel.
  useEffect(() => {
    const present = new Set(state.items.map((i) => i.id));
    for (const id of [...files.current.keys()]) {
      if (!present.has(id)) {
        files.current.delete(id);
        handles.current.delete(id);
      }
    }
  }, [state.items]);

  const enqueue = useCallback(
    (entries: readonly UploadRequestEntry[], parentId: string): string[] => {
      const uploads = entries.map((entry) => {
        counter.current += 1;
        const id = `upload-${Date.now().toString(36)}-${counter.current}`;
        files.current.set(id, entry.file);
        return {
          id,
          name: entry.file.name,
          size: entry.file.size,
          parentId,
          replaceId: entry.replaceId,
        };
      });
      dispatch({ type: "add", uploads });
      return uploads.map((upload) => upload.id);
    },
    [],
  );

  const pause = useCallback((id: string) => {
    handles.current.get(id)?.pause();
    dispatch({ type: "pause", id });
  }, []);

  const resume = useCallback((id: string) => {
    dispatch({ type: "resume", id });
    handles.current.get(id)?.start();
  }, []);

  const cancel = useCallback((id: string) => {
    handles.current.get(id)?.cancel();
    handles.current.delete(id);
    dispatch({ type: "cancel", id });
  }, []);

  const retry = useCallback((id: string) => {
    handles.current.delete(id);
    dispatch({ type: "retry", id });
  }, []);

  const dismiss = useCallback((id: string) => {
    dispatch({ type: "dismiss", id });
  }, []);

  const clearFinished = useCallback(() => {
    dispatch({ type: "clearFinished" });
  }, []);

  const value = useMemo<UploadsContext>(
    () => ({
      items: state.items,
      completed: state.completed,
      enqueue,
      pause,
      resume,
      cancel,
      retry,
      dismiss,
      clearFinished,
    }),
    [state, enqueue, pause, resume, cancel, retry, dismiss, clearFinished],
  );

  return <Context value={value}>{children}</Context>;
}

export function useUploads(): UploadsContext {
  const value = useContext(Context);
  if (!value) {
    throw new Error("useUploads must be used inside <UploadsProvider>");
  }
  return value;
}
