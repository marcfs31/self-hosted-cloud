import { describe, expect, it } from "vitest";
import { compactCode, groupSecret, recoveryFileText, stepUpFields } from "./security";

describe("groupSecret", () => {
  it("groups the key in fours", () => {
    expect(groupSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });

  it("keeps a short last group and never leaves a trailing space", () => {
    expect(groupSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
    expect(groupSecret("ABCDEFGH")).toBe("ABCD EFGH");
    expect(groupSecret("ABC")).toBe("ABC");
    expect(groupSecret("")).toBe("");
  });

  it("regroups a key that already has spaces", () => {
    expect(groupSecret("ABCD EFGH IJ")).toBe("ABCD EFGH IJ");
  });
});

describe("compactCode", () => {
  it("removes spaces typed into a code", () => {
    expect(compactCode("123 456")).toBe("123456");
    expect(compactCode(" abcde-fghij ")).toBe("abcde-fghij");
  });
});

describe("recoveryFileText", () => {
  it("lists one code per line under the heading", () => {
    expect(recoveryFileText("Codes", ["aaaaa-bbbbb", "ccccc-ddddd"])).toBe(
      "Codes\n\naaaaa-bbbbb\nccccc-ddddd\n",
    );
  });
});

describe("stepUpFields", () => {
  it("sends only the password when the account has no second factor", () => {
    expect(stepUpFields("pw", "123456", false)).toEqual({ password: "pw" });
  });

  it("adds the code, without spaces, when two-step verification is on", () => {
    expect(stepUpFields("pw", " 123 456 ", true)).toEqual({ password: "pw", code: "123456" });
  });

  it("keeps the password exactly as typed", () => {
    expect(stepUpFields("  pw with spaces ", "", false).password).toBe("  pw with spaces ");
  });
});
