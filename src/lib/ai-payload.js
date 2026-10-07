// src/lib/ai-payload.js
// Riesportazione del modulo condiviso con la Edge Function: la sanificazione
// dei dati in uscita e la validazione delle risposte devono essere le stesse
// ovunque. Il file vero sta in supabase/functions/_shared/.
export * from "../../supabase/functions/_shared/ai-payload.js";
