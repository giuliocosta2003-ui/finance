// src/contexts/AuthContext.jsx
// Sessione e profilo. Regola presa da saitex: il profilo si legge SEMPRE dalla
// tabella profiles dopo login e refresh, mai dal JWT. Qui non esistono ruoli:
// ogni utente vede solo i propri dati, e le policy RLS lo impongono comunque.
import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "../lib/supabase";

// Colonne del profilo che il client puo' leggere. Elencate una per una: se
// domani la tabella cresce, qui si decide cosa serve davvero al frontend.
const PROFILE_COLUMNS =
  "id, full_name, intro, profile_type, base_currency, country, locale, onboarding_completed, ai_consent_at, created_at, updated_at";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = ancora in caricamento
  const [profile, setProfile] = useState(undefined); // undefined = non ancora letto
  const [profileError, setProfileError] = useState(null);
  // Il link "password dimenticata" riporta nell'app con una sessione valida:
  // finche' non si sceglie la nuova password l'app resta su quella schermata.
  const [recovery, setRecovery] = useState(false);

  // Evita che una risposta lenta di un utente precedente sovrascriva il
  // profilo di quello attuale (login, logout, login veloce).
  const requestId = useRef(0);
  const lastUserId = useRef(null);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }
    const myId = ++requestId.current;
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .maybeSingle();
    if (myId !== requestId.current) return; // risposta superata da una piu' recente
    if (error) { setProfileError(error.message); setProfile(null); return; }
    setProfileError(null);
    setProfile(data ?? null);
  }, []);

  useEffect(() => {
    // onAuthStateChange emette INITIAL_SESSION come primo evento: non serve
    // una getSession() separata.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s ?? null);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);

      // Cambio di utente: il profilo torna "non ancora letto", altrimenti per
      // un istante si vedrebbe quello di prima.
      const uid = s?.user?.id ?? null;
      if (uid !== lastUserId.current) {
        lastUserId.current = uid;
        setProfile(uid ? undefined : null);
      }

      if (s?.user) loadProfile(s.user.id);
      else requestId.current++;
    });
    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    await loadProfile(user?.id);
  }, [loadProfile]);

  /** Aggiorna il proprio profilo. Le colonne scrivibili sono decise dai GRANT
   *  lato database (full_name, intro, profile_type, base_currency, country,
   *  locale, onboarding_completed, ai_consent_at): un patch su altre colonne
   *  viene rifiutato dal server, non da qui. */
  const updateProfile = useCallback(async (patch) => {
    const userId = session?.user?.id;
    if (!userId) return { ok: false, error: "no-session" };
    const { data, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .select(PROFILE_COLUMNS)
      .single();
    if (error) return { ok: false, error: error.message };
    setProfile(data);
    return { ok: true, profile: data };
  }, [session?.user?.id]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { ok: false, error: error.message } : { ok: true };
  }, []);

  const signUp = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    if (error) return { ok: false, error: error.message };
    // Senza sessione l'istanza chiede la conferma via email.
    return { ok: true, needsConfirmation: !data.session };
  }, []);

  const resetPassword = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  }, []);

  const updatePassword = useCallback(async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, error: error.message };
    setRecovery(false);
    return { ok: true };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    requestId.current++;
    setSession(null);
    setProfile(null);
    setRecovery(false);
  }, []);

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile: profile ?? null,
    profileError,
    recovery,
    // "loading" resta vero finche' non sappiamo sia se c'e' una sessione sia,
    // se c'e', com'e' fatto il profilo: cosi' nessuna pagina parte a meta'.
    loading: session === undefined || (session !== null && profile === undefined),
    needsOnboarding: !!session && profile != null && !profile.onboarding_completed,
    refreshProfile,
    updateProfile,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
  }), [session, profile, profileError, recovery, refreshProfile, updateProfile, signIn, signUp, signOut, resetPassword, updatePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve essere usato dentro <AuthProvider>");
  return ctx;
}
