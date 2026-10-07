// src/lib/image.js
// Preparazione delle foto prima dell'upload.
//
// Due problemi, entrambi risolti qui e non sul server:
//
// 1. HEIC. E' il formato predefinito delle foto su iPhone, e Claude non lo
//    accetta; il bucket `documents` nemmeno. Va convertito in JPEG, e va fatto
//    nel browser: e' l'unico posto dove il file c'e' gia' e dove esiste un
//    decodificatore senza aggiungere un megabyte di WebAssembly.
// 2. Dimensione. Una foto da 12 megapixel non si legge meglio di una da 2000
//    pixel di lato: costa solo banda e token.
//
// Il decodificatore e' quello del browser (`createImageBitmap`). Safari legge
// gli HEIC nativamente, ed e' da li' che arrivano: un iPhone che carica una
// foto passa quasi sempre da Safari. Dove il browser non sa decodificarlo lo
// diciamo, invece di caricare un file che poi nessuno riesce ad aprire.

/** I tipi che il bucket accetta e che Claude sa leggere. */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const HEIC = /\.(heic|heif)$/i;

/**
 * Un file va convertito? Sono due casi: gli HEIC, e le immagini in formati
 * che non stanno fra quelli accettati (per esempio i TIFF).
 * I PDF non si toccano: non sono immagini.
 */
export function needsConversion({ type = "", name = "" } = {}) {
  if (type === "application/pdf") return false;
  if (HEIC.test(name) || type === "image/heic" || type === "image/heif") return true;
  if (type.startsWith("image/")) return !ACCEPTED_IMAGE_TYPES.includes(type);
  // Senza tipo, decide il nome: alcuni browser mandano gli HEIC come
  // application/octet-stream.
  return HEIC.test(name);
}

/**
 * Dimensioni rimpicciolite mantenendo le proporzioni. Se l'immagine e' gia'
 * piu' piccola del limite non si tocca: reingrandirla non aggiunge dettaglio,
 * aggiunge solo byte.
 */
export function fitWithin(width, height, maxSide) {
  if (!width || !height) return { width, height };
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const ratio = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** Il nome del file convertito: stessa radice, estensione nuova. */
export function jpegName(name) {
  return String(name ?? "foto").replace(/\.[^.]+$/, "") + ".jpg";
}

/**
 * Converte e rimpicciolisce. Restituisce il file originale quando va gia'
 * bene: un PDF, o un JPEG piccolo, non hanno niente da guadagnare.
 *
 * Solo browser: usa createImageBitmap e canvas.
 */
export async function prepareImage(file, { maxSide = 2000, quality = 0.85 } = {}) {
  if (file.type === "application/pdf") return file;

  const convert = needsConversion(file);
  const big = file.size > 1_500_000;
  if (!convert && !big) return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Il browser non sa decodificarlo. Meglio dirlo adesso che archiviare un
    // file che poi non si apre.
    const error = new Error("unsupported_image");
    error.code = "unsupported_image";
    throw error;
  }

  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("unsupported_image");

  return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
}
