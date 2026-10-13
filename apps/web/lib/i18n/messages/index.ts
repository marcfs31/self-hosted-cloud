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

/** One entry per namespace. A new namespace adds a key here and one line per locale below. */
export interface Messages {
  common: commonEn.Common;
  auth: authEn.Auth;
  admin: adminEn.Admin;
  errors: errorsEn.Errors;
}

export const MESSAGES: Record<Locale, Messages> = {
  en: {
    common: commonEn.en,
    auth: authEn.en,
    admin: adminEn.en,
    errors: errorsEn.en,
  },
  "pt-PT": {
    common: commonPtPT.ptPT,
    auth: authPtPT.ptPT,
    admin: adminPtPT.ptPT,
    errors: errorsPtPT.ptPT,
  },
  es: {
    common: commonEs.es,
    auth: authEs.es,
    admin: adminEs.es,
    errors: errorsEs.es,
  },
  ca: {
    common: commonCa.ca,
    auth: authCa.ca,
    admin: adminCa.ca,
    errors: errorsCa.ca,
  },
  it: {
    common: commonIt.it,
    auth: authIt.it,
    admin: adminIt.it,
    errors: errorsIt.it,
  },
};
