// src/pages/dev/DevPage.jsx
// Monta una schermata VERA dentro il guscio, senza passare da ProtectedRoute.
// Solo in sviluppo.
//
// Serve a guardare e fotografare le schermate alle quattro larghezze senza una
// sessione attiva. Senza dati i componenti mostrano i loro stati vuoti, che
// sono comunque una cosa da verificare: il brief li chiede su ogni schermata,
// e sono quelli che nessuno guarda mai finche' non capitano a un utente vero.
//
// `?theme=` lo usa lo script degli screenshot; `/dev/shell` resta un alias di
// `/dev/page/shell`, che mostra contenuto finto invece di una schermata.
import { useParams } from "react-router-dom";
import Layout from "../../components/Layout";
import HomePage from "../HomePage";
import TransactionsPage from "../TransactionsPage";
import AccountsPage from "../AccountsPage";
import InvestmentsPage from "../InvestmentsPage";
import DocumentsPage from "../DocumentsPage";
import ImportsPage from "../ImportsPage";
import TaxesPage from "../TaxesPage";
import SettingsPage from "../SettingsPage";
import CategoriesPage from "../CategoriesPage";
import RulesPage from "../RulesPage";
import AllocationSettingsPage from "../AllocationSettingsPage";
import ShellSample from "./ShellSample";
import ReviewSample from "./ReviewSample";

const PAGES = {
  shell: ShellSample,
  home: HomePage,
  transactions: TransactionsPage,
  accounts: AccountsPage,
  investments: InvestmentsPage,
  documents: DocumentsPage,
  imports: ImportsPage,
  taxes: TaxesPage,
  settings: SettingsPage,
  categories: CategoriesPage,
  rules: RulesPage,
  allocation: AllocationSettingsPage,
  review: ReviewSample,
};

export default function DevPage() {
  const { name } = useParams();
  const Page = PAGES[name] ?? ShellSample;
  return <Layout><Page /></Layout>;
}
