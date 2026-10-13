/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": easier to read and to type into an app. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}

/** Strips the spaces a person may add when typing a setup key back, or a 6-digit code. */
export function compactCode(code: string): string {
  return code.replace(/\s+/g, "");
}

/** The step-up part of a request body: the password, and the code only when the account has one. */
export function stepUpFields(
  password: string,
  code: string,
  totpEnabled: boolean,
): { password: string; code?: string } {
  return totpEnabled ? { password, code: compactCode(code) } : { password };
}

export const RECOVERY_FILE_NAME = "cloud-recovery-codes.txt";

/** The text of the downloadable recovery-code file: a heading, a blank line, one code per line. */
export function recoveryFileText(heading: string, codes: readonly string[]): string {
  return `${heading}\n\n${codes.join("\n")}\n`;
}

/** Saves text as a file through a temporary object URL, which is released straight away. */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
