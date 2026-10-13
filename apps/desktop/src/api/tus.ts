import { createReadStream } from "node:fs";
import { access, constants } from "node:fs/promises";
import { errorResponse } from "@cloud/shared";
import { DetailedError, Upload } from "tus-js-client";
import { ApiError, BadResponseError, NetworkError } from "./errors.js";

export interface TusTarget {
  endpoint: string;
  authorization: string;
}

export interface TusFile {
  path: string;
  size: number;
  /** Upload-Metadata: filename, parentId and optionally replaceId. */
  metadata: Record<string, string>;
}

const RETRY_DELAYS_MS = [0, 1000, 3000, 5000];

function failureOf(err: Error): ApiError | NetworkError {
  if (err instanceof DetailedError && err.originalResponse) {
    let code;
    try {
      const parsed = errorResponse.safeParse(JSON.parse(err.originalResponse.getBody()));
      if (parsed.success) code = parsed.data.error.code;
    } catch {
      // not a JSON error body
    }
    return new ApiError(err.originalResponse.getStatus(), code);
  }
  return new NetworkError(`The upload failed: ${err.message}`);
}

/**
 * Resumable upload (tus 1.0.0): chunks are retried from the offset the server reports.
 * Resolves with the file's ID (the Cloud-File-Id header of the finishing response).
 */
export async function tusUpload(
  target: TusTarget,
  file: TusFile,
  chunkSize: number,
): Promise<string> {
  await access(file.path, constants.R_OK);
  // The Node build of tus-js-client reads an fs.ReadStream by its path, slice by slice.
  const source = createReadStream(file.path);
  source.on("error", () => undefined);
  return new Promise<string>((resolve, reject) => {
    const upload = new Upload(source, {
      endpoint: target.endpoint,
      headers: { Authorization: target.authorization },
      metadata: file.metadata,
      uploadSize: file.size,
      chunkSize,
      retryDelays: RETRY_DELAYS_MS,
      onError: (err) => {
        source.destroy();
        reject(failureOf(err));
      },
      onSuccess: ({ lastResponse }) => {
        source.destroy();
        const id = lastResponse.getHeader("Cloud-File-Id");
        if (id === undefined || id === "") reject(new BadResponseError());
        else resolve(id);
      },
    });
    upload.start();
  });
}
