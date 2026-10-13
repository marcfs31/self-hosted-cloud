import { isOne } from "../../plural";
import type { Search } from "./en";

export const ca: Search = {
  title: "Cerca",
  field: {
    label: "Cerca fitxers",
    placeholder: "Cerca pel nom…",
    submit: "Cerca",
  },
  idle: "Escriu una part del nom d'un fitxer o d'una carpeta per trobar-lo.",
  searching: "Cercant…",
  count: (n, q) => (isOne("ca", n) ? `${n} resultat per a «${q}»` : `${n} resultats per a «${q}»`),
  none: {
    title: (q) => `No s'ha trobat res per a «${q}»`,
    hint: "Revisa l'ortografia o prova amb una part més curta del nom.",
  },
  limited: (n) => `Es mostren les primeres ${n} coincidències. Escriu més del nom per acotar-les.`,
  caption: (q) => `Resultats per a ${q}`,
  location: "Ubicació",
  pathLabel: (name) => `On és ${name}`,
  preview: {
    controls: "Controls de la previsualització",
    previous: "Fitxer anterior",
    next: "Fitxer següent",
    position: (n, total) => `${n} de ${total}`,
    download: "Baixa",
    loading: "Carregant la previsualització…",
    truncated: (shown, total) =>
      `Es mostren els primers ${shown} de ${total}. Baixa el fitxer per llegir-lo sencer.`,
    empty: "Aquest fitxer és buit.",
    unavailable: "Aquest tipus de fitxer no es pot mostrar aquí. Pots baixar-lo.",
  },
};
