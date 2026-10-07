// src/lib/import/hash.js
// SHA-256 con WebCrypto: c'e' sia nel browser sia in Node, quindi lo stesso
// codice vale per l'app e per i test.

const hex = (buffer) =>
  [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");

export async function sha256Text(text) {
  const data = new TextEncoder().encode(String(text ?? ""));
  return hex(await crypto.subtle.digest("SHA-256", data));
}

export async function sha256Bytes(arrayBuffer) {
  return hex(await crypto.subtle.digest("SHA-256", arrayBuffer));
}

/**
 * Impronta dell'intestazione di un file: serve a riconoscere la banca e
 * riusare la mappatura salvata. Si normalizzano i nomi delle colonne (minuscolo,
 * senza accenti, senza punteggiatura) perche' le banche cambiano maiuscole e
 * spaziatura da un mese all'altro senza cambiare il tracciato.
 */
export async function headerFingerprint(headers) {
  const normalized = (headers ?? [])
    .map(h => String(h ?? "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim())
    .filter(Boolean);
  return sha256Text(normalized.join("|"));
}

/**
 * Impronta di una riga, per riconoscere i doppioni fra un estratto e l'altro.
 * `occurrence` distingue due movimenti identici nello stesso giorno: due caffe'
 * uguali sono due caffe', non un errore di importazione.
 */
export function dedupeInput({ accountId, bookedOn, amountMinor, merchant, occurrence = 0 }) {
  return [accountId, bookedOn, String(amountMinor), merchant ?? "", occurrence].join("|");
}

export async function dedupeHash(parts) {
  return sha256Text(dedupeInput(parts));
}
