import {
  DEFAULT_SHARE_EXPIRY_DAYS,
  createdShareResponse,
  type CreateShareRequest,
} from "@cloud/shared";
import { JSON_OPTION, parseCommandArgs, type Command } from "../args.js";
import { usageError } from "../errors.js";
import { formatPath, printJson } from "../format.js";
import { parseRemotePath, resolveNode } from "../paths.js";
import { readSecret } from "../prompt.js";
import { openSession } from "../session.js";

export const share: Command = {
  name: "share",
  summary: "Create a public share link",
  help: `Usage: cloud share <remote-path> [--expires-days N | --never] [--password-stdin] [--drop-box] [--json]

Create a link anyone can open without an account, and print it. By default the link expires
after ${DEFAULT_SHARE_EXPIRY_DAYS} days. A shared folder can be downloaded as a zip from the link.

Options:
  --expires-days N  Expire after N days, 1 to 365
  --never           The link never expires
  --password-stdin  Protect the link with a password (at least 8 characters), read from stdin
                    (typed without echo on a terminal)
  --drop-box        Folders only: visitors can upload into the folder but see nothing in it
  --json            Print machine-readable JSON on stdout: { url, share }`,
  async run(argv, io) {
    const { values, positionals } = parseCommandArgs(argv, {
      ...JSON_OPTION,
      "expires-days": { type: "string" },
      never: { type: "boolean" },
      "password-stdin": { type: "boolean" },
      "drop-box": { type: "boolean" },
    });
    const [target, ...extra] = positionals;
    if (target === undefined || extra.length > 0) {
      throw usageError("share needs exactly one remote path.");
    }
    if (values["expires-days"] !== undefined && values.never === true) {
      throw usageError("Use either --expires-days or --never, not both.");
    }
    let expiresInDays: number | null = DEFAULT_SHARE_EXPIRY_DAYS;
    if (values.never === true) expiresInDays = null;
    if (values["expires-days"] !== undefined) {
      const days = Number(values["expires-days"]);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw usageError("--expires-days must be a whole number from 1 to 365.");
      }
      expiresInDays = days;
    }
    const segments = parseRemotePath(target);
    if (segments.length === 0) throw usageError("The root folder cannot be shared.");

    let password: string | undefined;
    if (values["password-stdin"] === true) {
      password = await readSecret(io, "Share password (input is hidden): ");
      if (password.length < 8) throw usageError("The share password needs at least 8 characters.");
    }

    const { client, config } = await openSession(io);
    const node = await resolveNode(client, segments);
    const dropBox = values["drop-box"] === true;
    if (dropBox && node.kind !== "folder") {
      throw usageError("--drop-box only works on folders.");
    }
    const body: CreateShareRequest = { fileId: node.id, expiresInDays, allowUpload: dropBox };
    if (password !== undefined) body.password = password;
    const created = await client.json("POST", "/api/shares", createdShareResponse, body);
    const url = new URL(`/s/${created.token}`, config.server).toString();
    if (values.json === true) {
      printJson(io, { url, share: created.share });
      return;
    }
    io.stdout.write(`${url}\n`);
    const expiry =
      created.share.expiresAt === null ? "never expires" : `expires ${created.share.expiresAt}`;
    io.stderr.write(
      `Shared ${formatPath(segments)} (${expiry}${created.share.hasPassword ? ", password protected" : ""}${dropBox ? ", drop box" : ""})\n`,
    );
  },
};
