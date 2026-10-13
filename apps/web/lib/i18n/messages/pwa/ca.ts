import { isOne } from "../../plural";
import type { Pwa } from "./en";

export const ca: Pwa = {
  nav: { backup: "Còpia del mòbil" },
  install: {
    region: "Instal·la l'aplicació",
    text: "Instal·la Cloud en aquest dispositiu per obrir-lo com qualsevol altra aplicació.",
    button: "Instal·la l'aplicació",
    dismiss: "Ara no",
  },
  ios: {
    region: "Instal·la l'aplicació",
    text: "Per instal·lar Cloud en aquest dispositiu, toca el botó Comparteix i tria Afegeix a la pantalla d'inici.",
    dismiss: "Entès",
  },
  update: { text: "Actualització disponible", reload: "Recarrega" },
  offline: {
    title: "No es pot accedir a Cloud",
    body: "Sembla que no tens connexió o que el servidor no respon. Els teus fitxers estan segurs i tornaran a aparèixer així que tinguis connexió.",
    retry: "Torna-ho a provar",
  },
  picker: {
    hint: "Obre una carpeta per veure què conté i tria la que vulguis.",
    target: (folder) => `Carpeta seleccionada: ${folder}`,
    submit: "Fes servir aquesta carpeta",
  },
  share: {
    title: "Compartit amb Cloud",
    loading: "Cercant els fitxers compartits…",
    unsupported:
      "Aquest navegador no pot lliurar fitxers compartits a Cloud. Fes servir Puja als teus fitxers.",
    empty: {
      title: "No hi ha res per pujar aquí",
      hint: "Comparteix fotos o fitxers amb Cloud des d'una altra aplicació i apareixeran aquí.",
      back: "Torna als fitxers",
    },
    listLabel: "Fitxers compartits",
    count: (n) =>
      isOne("ca", n) ? `${n} fitxer a punt per pujar` : `${n} fitxers a punt per pujar`,
    destination: (folder) => `Puja a: ${folder}`,
    chooseFolder: "Tria una altra carpeta",
    pickerTitle: "Tria on pujar",
    upload: "Puja",
    uploading: "Pujant. El progrés es mostra al tauler de pujades.",
    discard: "Descarta",
    discarded: "S'han descartat els fitxers compartits.",
    finished: (n, folder) =>
      isOne("ca", n)
        ? `S'ha pujat ${n} fitxer a ${folder}.`
        : `S'han pujat ${n} fitxers a ${folder}.`,
    withFailures: (done, failed) =>
      `${done} pujats, ${failed} amb error. Pots tornar a provar els fallits al tauler de pujades.`,
    openFolder: "Obre la carpeta",
  },
  backup: {
    title: "Còpia del mòbil",
    intro:
      "Tria les fotos i els vídeos del teu mòbil i Cloud puja els que encara no té. Els fitxers que ja són al teu núvol s'ometen, encara que tinguin un altre nom.",
    limits:
      "La còpia només funciona mentre aquesta pàgina és oberta. Els mòbils no deixen que una aplicació web faci còpies totalment automàtiques en segon pla, així que obre aquesta pàgina de tant en tant i tria les fotos noves.",
    insecure:
      "La còpia del mòbil necessita una connexió segura (https) per comprovar els teus fitxers. Obre Cloud amb la seva adreça https.",
    destinationDefault: (folder) =>
      `Carpeta de la còpia: ${folder}, que es crea sola si encara no existeix.`,
    destinationChosen: (folder) => `Carpeta de la còpia: ${folder}`,
    chooseFolder: "Tria una altra carpeta",
    useDefault: "Fes servir la carpeta predeterminada",
    pickerTitle: "Tria la carpeta de la còpia",
    choose: "Tria fotos i vídeos",
    take: "Fes una foto",
    checking: (done, total) => `Comprovant ${done} de ${total}…`,
    uploading: (done, total) => `Pujant: ${done} de ${total} acabats`,
    summary: (already, uploaded, failed) =>
      `${already} ja tenien còpia, ${uploaded} pujats, ${failed} amb error`,
    cancelled: (n) => (isOne("ca", n) ? `${n} s'ha cancel·lat.` : `${n} s'han cancel·lat.`),
    unchecked: (n) =>
      isOne("ca", n)
        ? `${n} fitxer gran s'ha pujat sense comprovar duplicats (els fitxers de més de 512 MiB no es comproven).`
        : `${n} fitxers grans s'han pujat sense comprovar duplicats (els fitxers de més de 512 MiB no es comproven).`,
    failedHint: "Pots tornar a provar les pujades fallides al tauler de pujades.",
  },
};
