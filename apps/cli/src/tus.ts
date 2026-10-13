import { createReadStream } from "node:fs";
import { access, constants } from "node:fs/promises";
import { errorResponse } from "@cloud/shared";
import { DetailedError, Upload } from "tus-js-client";
import type { ApiClient } from "./client.js";
import { CliError, EXIT, apiError } from "./errors.js";

export interface TusFile {
  path: string;
  size: number;
  /** Upload-Metadata: filename, parentId and optionally replaceId. */
  metadata: Record<string, string>;
}

export interface TusOptions {
  chunkSize: number;
  onProgress?: (sent: number, total: number) => void;
}

const RETRY_DELAYS_MS = [0, 1000, 3000, 5000];

function failureOf(err: Error): CliError {
  if (err instanceof DetailedError && err.originalResponse) {
    let code;
    try {
      const parsed = errorResponse.safeParse(JSON.parse(err.originalResponse.getBody()));
      if (parsed.success) code = parsed.data.error.code;
    } catch {
      // not a JSON error body
    }
    return apiError(err.originalResponse.getStatus(), code);
  }
  return new CliError(`The upload failed: ${err.message}`, EXIT.other, "upload_failed");
}

/**
 * Resumable upload (tus 1.0.0): chunks are retried from the offset the server reports.
 * Resolves with the new file's ID (the Cloud-File-Id header of the finishing response).
 */
export async function tusUpload(
  client: ApiClient,
  file: TusFile,
  options: TusOptions,
): Promise<string> {
  await access(file.path, constants.R_OK);
  // The Node build of tus-js-client reads an fs.ReadStream by its path, slice by slice.
  const source = createReadStream(file.path);
  source.on("error", () => undefined);
  return new Promise<string>((resolve, reject) => {
    const upload = new Upload(source, {
      endpoint: client.url("/api/uploads"),
      headers: { Authorization: client.authorization },
      metadata: file.metadata,
      uploadSize: file.size,
      chunkSize: options.chunkSize,
      retryDelays: RETRY_DELAYS_MS,
      onProgress: (sent, total) => options.onProgress?.(sent, total),
      onError: (err) => {
        source.destroy();
        reject(failureOf(err));
      },
      onSuccess: ({ lastResponse }) => {
        source.destroy();
        const id = lastResponse.getHeader("Cloud-File-Id");
        if (id === undefined || id === "") {
          reject(
            new CliError("The server did not report the new file.", EXIT.other, "bad_response"),
          );
        } else {
          resolve(id);
        }
      },
    });
    upload.start();
  });
}
