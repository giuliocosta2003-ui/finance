// src/lib/merchant.js
// Riesportazione del modulo condiviso con la Edge Function. Il file vero sta
// sotto supabase/functions/_shared/ perche' Deno non puo' importare da src/,
// mentre Vite puo' importare da qualsiasi punto del progetto. Una sola copia,
// quindi frontend e server normalizzano allo stesso modo per costruzione.
export * from "../../supabase/functions/_shared/merchant.js";
