import { DetailedError, Upload, type PreviousUpload } from "tus-js-client";
import type { ErrorCode } from "@cloud/shared";
import { errorCodeFromBody } from "./api";

/**
 * The only module that talks to the tus endpoint. One handle per file; the panel's state
 * lives in upload-queue.ts and the React wiring in components/uploads.
 */

export const UPLOAD_ENDPOINT = "/api/uploads";
export const CHUNK_SIZE = 50 * 1024 * 1024;
export const RETRY_DELAYS = [0, 1000, 3000, 5000, 10000];

export interface UploadRequest {
  file: File;
  /** The destination folder, or null for a drop box, where the server fixes the folder itself. */
  parentId: string | null;
  /** The file this upload adds a version to, or null for a new file. */
  replaceId: string | null;
  /** The tus endpoint; the signed-in one when left out. */
  endpoint?: string;
}

export interface UploadEvents {
  /** Bytes the server has accepted so far. */
  onProgress: (sent: number) => void;
  /** `fileId` is the ID the server gave the finished file, if it said. */
  onSuccess: (fileId: string | null) => void;
  onError: (code: ErrorCode) => void;
}

export interface UploadHandle {
  /** Begins the upload, or continues it from the server's offset after a pause. */
  start: () => void;
  pause: () => void;
  /** Stops and deletes what the server holds. */
  cancel: () => void;
}

/** What the server is told about the file. `replaceId` is left out for a new file. */
export function metadataOf(request: UploadRequest): Record<string, string> {
  return {
    filename: request.file.name,
    ...(request.parentId === null ? {} : { parentId: request.parentId }),
    ...(request.file.type === "" ? {} : { filetype: request.file.type }),
    ...(request.replaceId === null ? {} : { replaceId: request.replaceId }),
  };
}

/**
 * Whether an unfinished upload found in storage is for the same destination. tus matches
 * on the file alone, but the server fixed the folder and the file to replace when it
 * created the upload, so resuming into a different target would put the bytes elsewhere.
 */
export function resumesSameTarget(previous: PreviousUpload, request: UploadRequest): boolean {
  return (
    previous.uploadUrl !== null &&
    previous.metadata["filename"] === request.file.name &&
    previous.metadata["parentId"] === (request.parentId ?? undefined) &&
    previous.metadata["replaceId"] === (request.replaceId ?? undefined)
  );
}

/** The API's error code for a failed upload; a dropped connection reads as internal. */
export function uploadErrorCode(error: Error): ErrorCode {
  if (error instanceof DetailedError && error.originalResponse) {
    try {
      return errorCodeFromBody(JSON.parse(error.originalResponse.getBody()));
    } catch {
      return "internal";
    }
  }
  return "internal";
}

export function createUpload(request: UploadRequest, events: UploadEvents): UploadHandle {
  const upload = new Upload(request.file, {
    endpoint: request.endpoint ?? UPLOAD_ENDPOINT,
    metadata: metadataOf(request),
    chunkSize: CHUNK_SIZE,
    retryDelays: RETRY_DELAYS,
    storeFingerprintForResuming: true,
    removeFingerprintOnSuccess: true,
    onProgress: (sent) => {
      events.onProgress(sent);
    },
    onSuccess: ({ lastResponse }) => {
      events.onSuccess(lastResponse.getHeader("Cloud-File-Id") ?? null);
    },
    onError: (error) => {
      events.onError(uploadErrorCode(error));
    },
  });

  let wanted = false;
  let lookingUp = false;
  let initialised = false;

  function launch() {
    if (wanted && !lookingUp) {
      upload.start();
    }
  }

  function findResumePoint() {
    // After a reload the person picks the same file again; this finds where it stopped.
    lookingUp = true;
    upload
      .findPreviousUploads()
      .then((previous) => {
        const match = previous.find((p) => resumesSameTarget(p, request));
        if (match) {
          upload.resumeFromPreviousUpload(match);
        }
      })
      .catch(() => {
        // Storage can be unavailable (private mode); the upload then simply starts over.
      })
      .finally(() => {
        lookingUp = false;
        launch();
      });
  }

  return {
    start() {
      wanted = true;
      if (initialised) {
        launch();
        return;
      }
      initialised = true;
      findResumePoint();
    },
    pause() {
      wanted = false;
      void upload.abort(false);
    },
    cancel() {
      wanted = false;
      upload.abort(true).catch(() => {
        // The server drops abandoned uploads on its own after they expire.
      });
    },
  };
}
