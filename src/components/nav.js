// src/components/nav.js
// L'elenco delle sezioni, in un posto solo.
//
// Barra laterale e barra in basso mostrano le stesse voci con due forme
// diverse: tenerle in due liste separate vorrebbe dire, prima o poi, una voce
// che esiste su desktop e non su telefono senza che nessuno se ne accorga.
//
// Su mobile in basso ci stanno cinque voci: quattro sezioni piu' "Altro", che
// apre le restanti. Sei voci su 390 px diventano etichette illeggibili.
import { Icon } from "./icons";

export const NAV_MAIN = [
  { to: "/",             icon: Icon.Home,         labelKey: "nav.home",         primary: true },
  { to: "/transactions", icon: Icon.Transactions, labelKey: "nav.transactions", primary: true },
  { to: "/investments",  icon: Icon.Investments,  labelKey: "nav.investments",  primary: true },
  { to: "/documents",    icon: Icon.Documents,    labelKey: "nav.documents",    primary: true },
];

export const NAV_MANAGE = [
  { to: "/accounts", icon: Icon.Accounts, labelKey: "nav.accounts" },
  { to: "/imports",  icon: Icon.Refresh,  labelKey: "nav.imports" },
  // Le tasse hanno senso solo per chi ha un'attivita': la voce compare solo per
  // il profilo imprenditore. Gli altri profili non la vedono affatto.
  { to: "/taxes",    icon: Icon.Taxes,    labelKey: "nav.taxes", entrepreneurOnly: true },
];

export const NAV_SETTINGS = { to: "/settings", icon: Icon.Settings, labelKey: "nav.settings" };

/** Le voci che NON stanno nella barra in basso: finiscono dentro "Altro". */
export const NAV_MORE = [...NAV_MANAGE, NAV_SETTINGS];

/** Tutte, per capire quale sezione e' attiva. */
export const NAV_ALL = [...NAV_MAIN, ...NAV_MANAGE, NAV_SETTINGS];

/**
 * Filtra le voci per profilo: quelle marcate `entrepreneurOnly` restano solo
 * per l'imprenditore. Serve alla barra laterale e al menu "Altro"; la barra in
 * basso usa NAV_MAIN, che non contiene voci riservate.
 */
export function forProfile(list, profileType) {
  return list.filter(i => !i.entrepreneurOnly || profileType === "entrepreneur");
}

/**
 * La rotta "/" e' attiva solo se il percorso e' esattamente "/": con
 * `startsWith` lo sarebbe sempre, e la Home resterebbe accesa ovunque.
 */
export function isActive(pathname, to) {
  return to === "/" ? pathname === "/" : pathname.startsWith(to);
}

/** La voce corrispondente al percorso corrente, per il titolo della barra in alto. */
export function currentSection(pathname) {
  return [...NAV_ALL]
    .sort((a, b) => b.to.length - a.to.length)
    .find(item => isActive(pathname, item.to));
}

/**
 * Le azioni del "+": le quattro cose che si creano piu' spesso.
 * Ognuna porta alla sua schermata con un parametro che le dice di aprirsi
 * gia' sul modulo giusto, senza duplicare qui i moduli.
 */
export const CREATE_ACTIONS = [
  { key: "transaction", to: "/transactions?new=tx",       icon: Icon.Plus,      labelKey: "create.transaction", shortKey: "create.transactionShort" },
  { key: "transfer",    to: "/transactions?new=transfer", icon: Icon.Transfer,  labelKey: "create.transfer",    shortKey: "create.transferShort" },
  { key: "import",      to: "/imports?new=1",             icon: Icon.Refresh,   labelKey: "create.import",      shortKey: "create.importShort" },
  { key: "document",    to: "/documents?new=1",           icon: Icon.Documents, labelKey: "create.document",    shortKey: "create.documentShort" },
];
