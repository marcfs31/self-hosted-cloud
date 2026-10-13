import { DetailedError, type HttpResponse, type PreviousUpload } from "tus-js-client";
import { describe, expect, it } from "vitest";
import { metadataOf, resumesSameTarget, uploadErrorCode, type UploadRequest } from "./uploads";

function request(over: Partial<UploadRequest> = {}): UploadRequest {
  return {
    file: new File(["hello"], "notes.txt", { type: "text/plain" }),
    parentId: "folder-1",
    replaceId: null,
    ...over,
  };
}

function previous(metadata: Record<string, string>, uploadUrl: string | null): PreviousUpload {
  return {
    size: 5,
    metadata,
    creationTime: "2026-10-13T00:00:00.000Z",
    urlStorageKey: "key",
    uploadUrl,
    parallelUploadUrls: null,
  };
}

function failure(status: number, body: string): DetailedError {
  const response = { getStatus: () => status, getBody: () => body } as unknown as HttpResponse;
  return Object.assign(new DetailedError("tus: failed"), { originalResponse: response });
}

describe("upload metadata", () => {
  it("names the file and its folder, and leaves replaceId out for a new file", () => {
    expect(metadataOf(request())).toEqual({
      filename: "notes.txt",
      parentId: "folder-1",
      filetype: "text/plain",
    });
  });

  it("carries replaceId when adding a version, and no filetype when the browser has none", () => {
    expect(metadataOf(request({ file: new File(["x"], "data.bin"), replaceId: "file-9" }))).toEqual(
      { filename: "data.bin", parentId: "folder-1", replaceId: "file-9" },
    );
  });
});

describe("resuming a stored upload", () => {
  const stored = { filename: "notes.txt", parentId: "folder-1" };

  it("resumes when the name, folder and replaced file all match", () => {
    expect(resumesSameTarget(previous(stored, "/api/uploads/abc"), request())).toBe(true);
    expect(
      resumesSameTarget(
        previous({ ...stored, replaceId: "file-9" }, "/api/uploads/abc"),
        request({ replaceId: "file-9" }),
      ),
    ).toBe(true);
  });

  it("does not resume into a different folder", () => {
    expect(
      resumesSameTarget(previous(stored, "/api/uploads/abc"), request({ parentId: "folder-2" })),
    ).toBe(false);
  });

  it("does not resume a plain upload as a replacement, or the other way round", () => {
    expect(
      resumesSameTarget(previous(stored, "/api/uploads/abc"), request({ replaceId: "file-9" })),
    ).toBe(false);
    expect(
      resumesSameTarget(
        previous({ ...stored, replaceId: "file-9" }, "/api/uploads/abc"),
        request(),
      ),
    ).toBe(false);
  });

  it("does not resume an entry that never got an upload URL", () => {
    expect(resumesSameTarget(previous(stored, null), request())).toBe(false);
  });
});

describe("upload errors", () => {
  it("reads the API error code from the response body", () => {
    expect(uploadErrorCode(failure(413, '{"error":{"code":"quota_exceeded"}}'))).toBe(
      "quota_exceeded",
    );
  });

  it("reads anything else as an internal error", () => {
    expect(uploadErrorCode(failure(502, "<html>bad gateway</html>"))).toBe("internal");
    expect(uploadErrorCode(failure(400, '{"error":{"code":"nope"}}'))).toBe("internal");
    expect(uploadErrorCode(new Error("network"))).toBe("internal");
  });
});
