import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { I18nProvider } from "./i18n/I18nContext";
import { AuthProvider } from "./contexts/AuthContext";
import { CurrenciesProvider } from "./contexts/CurrenciesContext";
import { ToastProvider } from "./components/Toast";
import App from "./App.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>
              <CurrenciesProvider>
                <ToastProvider>
                  <App />
                </ToastProvider>
              </CurrenciesProvider>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
