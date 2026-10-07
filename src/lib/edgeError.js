// src/lib/edgeError.js
// Legge il VERO errore di una Edge Function.
//
// `supabase.functions.invoke()` su una risposta non-2xx non guarda il corpo:
// alza un `FunctionsHttpError` il cui `.message` e' sempre la stessa frase,
// "Edge Function returned a non-2xx status code", e mette la `Response` intera
// in `.context`. Chi scriveva `error.message` mostrava quindi quella frase a
// prescindere da cosa fosse successo davvero.
//
// Le nostre funzioni rispondono gia' con un codice macchina
// (`{ "error": "ai_not_configured" }`), e le schermate sanno tradurlo: mancava
// solo qualcuno che lo tirasse fuori dalla risposta. Questo file fa quello.

/** Il codice generico quando non si riesce a capire piu' di cosi'. */
export const UNKNOWN_ERROR = "unknown_error";

/**
 * @param {unknown} error l'errore di `functions.invoke`
 * @returns {Promise<{code: string, message: string|null, status: number|null}>}
 *   `code` e' il codice macchina da tradurre; `message` l'eventuale dettaglio
 *   tecnico, da mostrare solo come contorno.
 */
export async function readFunctionError(error) {
  if (!error) return { code: UNKNOWN_ERROR, message: null, status: null };

  const response = error.context;
  const status = typeof response?.status === "number" ? response.status : null;

  // `.context` e' una Response solo per FunctionsHttpError. Per un errore di
  // rete (FunctionsFetchError) non c'e' corpo da leggere, e resta il messaggio.
  if (response && typeof response.json === "function") {
    // Si clona: il corpo di una Response si puo' leggere una volta sola, e
    // chi chiama potrebbe volerlo ancora. Se `clone` non c'e' (in un test, o
    // in un polyfill), si legge l'originale.
    const readable = typeof response.clone === "function" ? response.clone() : response;
    try {
      const body = await readable.json();
      const code = typeof body?.error === "string" && body.error.trim() !== ""
        ? body.error.trim()
        : null;
      const message = typeof body?.message === "string" ? body.message : null;
      if (code) return { code, message, status };
      if (message) return { code: UNKNOWN_ERROR, message, status };
    } catch {
      // Corpo non JSON (una pagina di errore del gateway, per esempio):
      // si ripiega sul messaggio dell'eccezione.
    }
  }

  const message = typeof error.message === "string" && error.message.trim() !== ""
    ? error.message
    : null;
  return { code: UNKNOWN_ERROR, message, status };
}

/**
 * La stessa cosa quando al chiamante serve una stringa sola.
 * Ritorna il codice, che le schermate traducono con `errorText`.
 */
export async function functionErrorCode(error) {
  const { code, message } = await readFunctionError(error);
  // Un codice sconosciuto senza nemmeno un messaggio non aiuterebbe nessuno:
  // meglio il messaggio grezzo che la parola "unknown_error".
  if (code === UNKNOWN_ERROR && message) return message;
  return code;
}
