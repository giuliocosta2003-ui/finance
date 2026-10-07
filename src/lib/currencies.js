// src/lib/currencies.js
// Valute selezionabili come valuta base. Anche qui solo i codici: il nome
// arriva da Intl.DisplayNames nella lingua corrente (currencyName in
// format.js). La tabella `currencies` del database (fase 2) restera' la fonte
// di verita' per le minor units lato server.
export const CURRENCY_CODES = [
  "EUR", "USD", "VND", "GBP", "CHF", "JPY", "CNY", "AUD", "CAD", "SGD",
  "HKD", "KRW", "THB", "MYR", "IDR", "PHP", "INR", "AED", "SAR", "QAR",
  "KWD", "BHD", "TRY", "RUB", "PLN", "CZK", "HUF", "RON", "SEK", "NOK",
  "DKK", "ILS", "ZAR", "BRL", "MXN", "ARS", "CLP", "NZD", "TWD", "LAK",
  "KHR", "EGP", "MAD", "NGN", "PKR", "UAH",
];

// Le tre valute del caso d'uso principale, mostrate in cima alla lista.
export const SUGGESTED_CURRENCIES = ["EUR", "USD", "VND"];
