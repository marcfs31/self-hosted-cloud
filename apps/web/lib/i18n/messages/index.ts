import type { Locale } from "../locales";
import * as adminCa from "./admin/ca";
import * as adminEn from "./admin/en";
import * as adminEs from "./admin/es";
import * as adminIt from "./admin/it";
import * as adminPtPT from "./admin/pt-PT";
import * as authCa from "./auth/ca";
import * as authEn from "./auth/en";
import * as authEs from "./auth/es";
import * as authIt from "./auth/it";
import * as authPtPT from "./auth/pt-PT";
import * as commonCa from "./common/ca";
import * as commonEn from "./common/en";
import * as commonEs from "./common/es";
import * as commonIt from "./common/it";
import * as commonPtPT from "./common/pt-PT";
import * as errorsCa from "./errors/ca";
import * as errorsEn from "./errors/en";
import * as errorsEs from "./errors/es";
import * as errorsIt from "./errors/it";
import * as errorsPtPT from "./errors/pt-PT";
import * as filesEn from "./files/en";
import * as filesPtPT from "./files/pt-PT";
import * as filesEs from "./files/es";
import * as filesCa from "./files/ca";
import * as filesIt from "./files/it";
import * as trashEn from "./trash/en";
import * as trashPtPT from "./trash/pt-PT";
import * as trashEs from "./trash/es";
import * as trashCa from "./trash/ca";
import * as trashIt from "./trash/it";
import * as pwaEn from "./pwa/en";
import * as pwaPtPT from "./pwa/pt-PT";
import * as pwaEs from "./pwa/es";
import * as pwaCa from "./pwa/ca";
import * as pwaIt from "./pwa/it";

/** One entry per namespace. A new namespace adds a key here and one line per locale below. */
export interface Messages {
  common: commonEn.Common;
  auth: authEn.Auth;
  admin: adminEn.Admin;
  errors: errorsEn.Errors;
  files: filesEn.Files;
  trash: trashEn.Trash;
  pwa: pwaEn.Pwa;
}

export const MESSAGES: Record<Locale, Messages> = {
  en: {
    common: commonEn.en,
    auth: authEn.en,
    admin: adminEn.en,
    errors: errorsEn.en,
    files: filesEn.en,
    trash: trashEn.en,
    pwa: pwaEn.en,
  },
  "pt-PT": {
    common: commonPtPT.ptPT,
    auth: authPtPT.ptPT,
    admin: adminPtPT.ptPT,
    errors: errorsPtPT.ptPT,
    files: filesPtPT.ptPT,
    trash: trashPtPT.ptPT,
    pwa: pwaPtPT.ptPT,
  },
  es: {
    common: commonEs.es,
    auth: authEs.es,
    admin: adminEs.es,
    errors: errorsEs.es,
    files: filesEs.es,
    trash: trashEs.es,
    pwa: pwaEs.es,
  },
  ca: {
    common: commonCa.ca,
    auth: authCa.ca,
    admin: adminCa.ca,
    errors: errorsCa.ca,
    files: filesCa.ca,
    trash: trashCa.ca,
    pwa: pwaCa.ca,
  },
  it: {
    common: commonIt.it,
    auth: authIt.it,
    admin: adminIt.it,
    errors: errorsIt.it,
    files: filesIt.it,
    trash: trashIt.it,
    pwa: pwaIt.it,
  },
};
