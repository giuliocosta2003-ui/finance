// src/lib/countries.js
// Codici paese ISO 3166-1 alpha-2. I NOMI non stanno qui: si ricavano da
// Intl.DisplayNames nella lingua corrente (vedi countryName in format.js),
// cosi' non serve tradurre a mano 200 paesi.
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ " +
  "CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FO " +
  "FR GA GB GD GE GH GI GL GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM " +
  "JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK " +
  "ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PR PS PT " +
  "PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM " +
  "TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW"
).split(" ");

// Valuta ufficiale del paese, usata solo per PRE-selezionare la valuta base in
// onboarding: l'utente puo' sempre cambiarla (chi vive in VN e ragiona in EUR
// e' esattamente il caso d'uso di questa app).
export const COUNTRY_CURRENCY = {
  AE: "AED", AR: "ARS", AT: "EUR", AU: "AUD", BE: "EUR", BG: "BGN", BH: "BHD", BR: "BRL",
  CA: "CAD", CH: "CHF", CL: "CLP", CN: "CNY", CO: "COP", CY: "EUR", CZ: "CZK", DE: "EUR",
  DK: "DKK", EE: "EUR", EG: "EGP", ES: "EUR", FI: "EUR", FR: "EUR", GB: "GBP", GR: "EUR",
  HK: "HKD", HR: "EUR", HU: "HUF", ID: "IDR", IE: "EUR", IL: "ILS", IN: "INR", IS: "ISK",
  IT: "EUR", JP: "JPY", KH: "KHR", KR: "KRW", KW: "KWD", LA: "LAK", LT: "EUR", LU: "EUR",
  LV: "EUR", MA: "MAD", MT: "EUR", MX: "MXN", MY: "MYR", NG: "NGN", NL: "EUR", NO: "NOK",
  NZ: "NZD", PE: "PEN", PH: "PHP", PK: "PKR", PL: "PLN", PT: "EUR", QA: "QAR", RO: "RON",
  RS: "RSD", RU: "RUB", SA: "SAR", SE: "SEK", SG: "SGD", SI: "EUR", SK: "EUR", TH: "THB",
  TN: "TND", TR: "TRY", TW: "TWD", UA: "UAH", US: "USD", UY: "UYU", VN: "VND", ZA: "ZAR",
};
