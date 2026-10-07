// src/lib/image.test.js — node --test
// Le decisioni sulla preparazione delle immagini, quelle che si possono
// provare senza un browser: cosa va convertito e a che dimensioni.
// La conversione vera usa createImageBitmap e canvas, che in Node non ci sono.
import test from "node:test";
import assert from "node:assert/strict";
import { needsConversion, fitWithin, jpegName, ACCEPTED_IMAGE_TYPES } from "./image.js";

test("un HEIC va sempre convertito, comunque arrivi", () => {
  assert.equal(needsConversion({ type: "image/heic", name: "IMG_0042.HEIC" }), true);
  assert.equal(needsConversion({ type: "image/heif", name: "foto.heif" }), true);
  // iOS a volte non manda il tipo: decide il nome.
  assert.equal(needsConversion({ type: "", name: "IMG_0042.HEIC" }), true);
  assert.equal(needsConversion({ type: "application/octet-stream", name: "a.heic" }), true);
});

test("i formati che il bucket accetta passano cosi' come sono", () => {
  for (const type of ACCEPTED_IMAGE_TYPES) {
    assert.equal(needsConversion({ type, name: "x" }), false, type);
  }
});

test("un PDF non e' un'immagine e non si tocca", () => {
  assert.equal(needsConversion({ type: "application/pdf", name: "fattura.pdf" }), false);
});

test("un formato immagine che nessuno accetta va convertito", () => {
  assert.equal(needsConversion({ type: "image/tiff", name: "scan.tif" }), true);
  assert.equal(needsConversion({ type: "image/bmp", name: "x.bmp" }), true);
});

test("il ridimensionamento mantiene le proporzioni", () => {
  assert.deepEqual(fitWithin(4032, 3024, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(fitWithin(3024, 4032, 2000), { width: 1500, height: 2000 });
  assert.deepEqual(fitWithin(1000, 1000, 2000), { width: 1000, height: 1000 });
});

test("un'immagine gia' piccola non viene reingrandita", () => {
  // Reingrandire non aggiunge dettaglio: aggiunge solo byte.
  assert.deepEqual(fitWithin(800, 600, 2000), { width: 800, height: 600 });
});

test("il nome cambia estensione, non radice", () => {
  assert.equal(jpegName("IMG_0042.HEIC"), "IMG_0042.jpg");
  assert.equal(jpegName("fattura acme.png"), "fattura acme.jpg");
  assert.equal(jpegName("senza-estensione"), "senza-estensione.jpg");
});
