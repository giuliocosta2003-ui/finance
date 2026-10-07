// Scrive su disco le fixture sintetiche, per poterle aprire e guardare.
// Non serve ai test, che le generano in memoria.
import { mkdirSync, writeFileSync } from "node:fs";
import { FIXTURES } from "./synthetic.js";

mkdirSync(new URL("./synthetic/", import.meta.url), { recursive: true });
for (const [name, build] of Object.entries(FIXTURES)) {
  const bytes = build();
  writeFileSync(new URL(`./synthetic/${name}`, import.meta.url), bytes);
  console.log(name, bytes.length, "byte");
}
