// src/lib/edgeError.test.js — node --test
//
// Il caso che ha fatto nascere questo file: con ANTHROPIC_API_KEY non
// configurata le funzioni AI rispondono 503 {"error":"ai_not_configured"}, ma
// l'utente leggeva "Edge Function returned a non-2xx status code" — il
// messaggio fisso di supabase-js, che del corpo non sa niente.
import test from "node:test";
import assert from "node:assert/strict";
import { readFunctionError, functionErrorCode, UNKNOWN_ERROR } from "./edgeError.js";

/** Un finto FunctionsHttpError: messaggio fisso, Response in `.context`. */
const httpError = (status, body, { json = true } = {}) => ({
  name: "FunctionsHttpError",
  message: "Edge Function returned a non-2xx status code",
  context: new Response(json ? JSON.stringify(body) : String(body), {
    status,
    headers: { "content-type": json ? "application/json" : "text/html" },
  }),
});

test("tira fuori il codice dal corpo della risposta", async () => {
  const { code, status } = await readFunctionError(httpError(503, { error: "ai_not_configured" }));
  assert.equal(code, "ai_not_configured");
  assert.equal(status, 503);
});

test("tiene anche il messaggio tecnico quando c'e'", async () => {
  const { code, message } = await readFunctionError(
    httpError(502, { error: "ai_failed", message: "overloaded_error" }),
  );
  assert.equal(code, "ai_failed");
  assert.equal(message, "overloaded_error");
});

test("non consuma il corpo: chi chiama puo' rileggerlo", async () => {
  // Se si leggesse la Response originale invece di un clone, questa seconda
  // lettura fallirebbe con "Body is unusable".
  const error = httpError(403, { error: "ai_consent_required" });
  await readFunctionError(error);
  const again = await error.context.json();
  assert.equal(again.error, "ai_consent_required");
});

test("un corpo non JSON non fa esplodere niente", async () => {
  // Un 502 del gateway restituisce HTML, non JSON.
  const { code, message } = await readFunctionError(
    httpError(502, "<html>Bad Gateway</html>", { json: false }),
  );
  assert.equal(code, UNKNOWN_ERROR);
  assert.equal(message, "Edge Function returned a non-2xx status code");
});

test("un errore di rete non ha corpo: resta il suo messaggio", async () => {
  // FunctionsFetchError: `.context` e' l'eccezione di fetch, non una Response.
  const { code, message, status } = await readFunctionError({
    name: "FunctionsFetchError",
    message: "Failed to send a request to the Edge Function",
    context: new TypeError("network error"),
  });
  assert.equal(code, UNKNOWN_ERROR);
  assert.equal(message, "Failed to send a request to the Edge Function");
  assert.equal(status, null);
});

test("nessun errore: non si finge che ce ne sia uno di preciso", async () => {
  const { code, message } = await readFunctionError(null);
  assert.equal(code, UNKNOWN_ERROR);
  assert.equal(message, null);
});

test("un corpo JSON senza campo error non inventa un codice", async () => {
  const { code } = await readFunctionError(httpError(500, { detail: "boom" }));
  assert.equal(code, UNKNOWN_ERROR);
});

// ── functionErrorCode ────────────────────────────────────────────────────────

test("functionErrorCode da' il codice quando c'e'", async () => {
  assert.equal(
    await functionErrorCode(httpError(503, { error: "ai_not_configured" })),
    "ai_not_configured",
  );
});

test("functionErrorCode preferisce il messaggio a 'unknown_error'", async () => {
  // Meglio una frase tecnica che una parola che non dice niente.
  assert.equal(
    await functionErrorCode({ message: "Failed to fetch", context: undefined }),
    "Failed to fetch",
  );
});
