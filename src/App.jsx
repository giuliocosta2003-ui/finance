// src/App.jsx
// Rotte dell'app. Ce ne sono poche di proposito: fuori dal login esiste solo
// cio' che ProtectedRoute lascia passare.
import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { useI18n } from "./i18n/I18nContext";
import ProtectedRoute from "./components/ProtectedRoute";
import InvestmentsPage from "./pages/InvestmentsPage";
import HoldingPage from "./pages/HoldingPage";
import DocumentsPage from "./pages/DocumentsPage";
import DocumentPage from "./pages/DocumentPage";
import AllocationSettingsPage from "./pages/AllocationSettingsPage";
import TaxesPage from "./pages/TaxesPage";
import TaxPeriodPage from "./pages/TaxPeriodPage";
import Layout from "./components/Layout";

// La galleria del design system esiste solo in sviluppo. Caricata con `lazy`
// dietro a import.meta.env.DEV, che in produzione diventa `false`: il ramo
// muore e il bundle non la porta con se'.
const UiGallery = import.meta.env.DEV
  ? lazy(() => import("./pages/dev/UiGallery.jsx"))
  : null;
const DevPage = import.meta.env.DEV
  ? lazy(() => import("./pages/dev/DevPage.jsx"))
  : null;
import Loading from "./components/Loading";
import LoginPage from "./pages/LoginPage";
import OnboardingPage from "./pages/OnboardingPage";
import HomePage from "./pages/HomePage";
import SettingsPage from "./pages/SettingsPage";
import AccountsPage from "./pages/AccountsPage";
import TransactionsPage from "./pages/TransactionsPage";
import CategoriesPage from "./pages/CategoriesPage";
import ImportsPage from "./pages/ImportsPage";
import ReviewPage from "./pages/ReviewPage";
import RulesPage from "./pages/RulesPage";

export default function App() {
  const { loading, session, profile, recovery } = useAuth();
  const { t, lang, setLang } = useI18n();

  // Dopo l'onboarding la lingua e' una preferenza del profilo: la si segue,
  // cosi' e' la stessa su ogni dispositivo. DURANTE l'onboarding invece vince
  // la scelta fatta nella barra in alto (che viene salvata alla fine).
  const profileLocale = profile?.onboarding_completed ? profile.locale : null;
  useEffect(() => {
    if (profileLocale && profileLocale !== lang) setLang(profileLocale);
  }, [profileLocale, lang, setLang]);

  if (loading) return <Loading fullScreen label={t("common.loading")} />;

  const signedIn = !!session && !recovery;

  return (
    <Routes>
      {import.meta.env.DEV && (
        <Route path="/dev/page/:name" element={
          <Suspense fallback={<Loading fullScreen label={t("common.loading")} />}>
            <DevPage />
          </Suspense>
        } />
      )}

      {import.meta.env.DEV && (
        <Route path="/dev/ui" element={
          <Suspense fallback={<Loading fullScreen label={t("common.loading")} />}>
            <UiGallery />
          </Suspense>
        } />
      )}

      <Route path="/login" element={signedIn ? <Navigate to="/" replace /> : <LoginPage />} />

      <Route path="/onboarding" element={
        <ProtectedRoute allowIncompleteOnboarding>
          {profile?.onboarding_completed ? <Navigate to="/" replace /> : <OnboardingPage />}
        </ProtectedRoute>
      } />

      <Route path="/" element={
        <ProtectedRoute><Layout><HomePage /></Layout></ProtectedRoute>
      } />

      <Route path="/accounts" element={
        <ProtectedRoute><Layout><AccountsPage /></Layout></ProtectedRoute>
      } />

      <Route path="/transactions" element={
        <ProtectedRoute><Layout><TransactionsPage /></Layout></ProtectedRoute>
      } />

      <Route path="/imports" element={
        <ProtectedRoute><Layout><ImportsPage /></Layout></ProtectedRoute>
      } />

      <Route path="/imports/:importId" element={
        <ProtectedRoute><Layout><ReviewPage /></Layout></ProtectedRoute>
      } />

      <Route path="/investments" element={
        <ProtectedRoute><Layout><InvestmentsPage /></Layout></ProtectedRoute>
      } />

      <Route path="/investments/:holdingId" element={
        <ProtectedRoute><Layout><HoldingPage /></Layout></ProtectedRoute>
      } />

      <Route path="/documents" element={
        <ProtectedRoute><Layout><DocumentsPage /></Layout></ProtectedRoute>
      } />

      <Route path="/documents/:documentId" element={
        <ProtectedRoute><Layout><DocumentPage /></Layout></ProtectedRoute>
      } />

      <Route path="/taxes" element={
        <ProtectedRoute><Layout><TaxesPage /></Layout></ProtectedRoute>
      } />

      <Route path="/taxes/period/:periodId" element={
        <ProtectedRoute><Layout><TaxPeriodPage /></Layout></ProtectedRoute>
      } />

      <Route path="/settings" element={
        <ProtectedRoute><Layout><SettingsPage /></Layout></ProtectedRoute>
      } />

      <Route path="/settings/rules" element={
        <ProtectedRoute><Layout><RulesPage /></Layout></ProtectedRoute>
      } />

      <Route path="/settings/allocation" element={
        <ProtectedRoute><Layout><AllocationSettingsPage /></Layout></ProtectedRoute>
      } />

      <Route path="/settings/categories" element={
        <ProtectedRoute><Layout><CategoriesPage /></Layout></ProtectedRoute>
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
