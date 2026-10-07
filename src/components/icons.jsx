// src/components/icons.jsx
// Icone (lucide-react) esportate con nomi coerenti con l'app. Un unico punto
// d'importazione: se in futuro si cambia libreria, si tocca solo questo file.
// Uso: import { Icon, ICON } from "../components/icons";
//      <Icon.Home size={ICON.md} />
//
// Perche' lucide e non un miscuglio: e' una sola famiglia, geometrica, con lo
// stesso spessore di tratto su tutte le icone e la stessa griglia da 24. Il
// brief chiede proprio questo — icone che sembrino disegnate insieme — e
// mescolare due librerie lo rende impossibile per quanta cura ci si metta.
import { forwardRef } from "react";
import {
  LayoutDashboard, Settings, LogOut, Menu, X, Sun, Moon, Globe,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Check, AlertTriangle, Info, Mail,
  Wallet, ArrowLeftRight, PiggyBank, TrendingUp, Receipt, FileText,
  User, Eye, EyeOff, Pencil, Archive, ArchiveRestore, Plus, Trash2,
  SlidersHorizontal, Search, Tags, RefreshCw,
} from "lucide-react";

/**
 * La scala delle dimensioni. Prima ce n'erano dieci diverse (12, 13, 14, 15,
 * 16, 18, 20, 22, 24, 28) scelte una alla volta: il risultato e' che due icone
 * affiancate non erano mai della stessa taglia. Quattro valori bastano, e
 * sono quelli che il brief chiede.
 *
 *   inline  dentro una pastiglia o accanto a una didascalia
 *   sm      dentro un pulsante, in tabella, nelle righe di elenco
 *   md      navigazione, barre degli strumenti
 *   lg      intestazioni, stati vuoti piccoli
 *   xl      stati vuoti grandi, illustrazioni
 */
export const ICON = {
  inline: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
};

/**
 * Tratto leggermente piu' sottile del predefinito di lucide (2). A 16 e 20 px
 * un tratto da 2 px impasta i dettagli e da' alle icone un'aria da fumetto;
 * 1.75 le tiene nitide e piu' vicine al segno tecnico di un'interfaccia
 * bancaria. Un valore solo, applicato a tutte: e' cio' che le fa sembrare
 * disegnate insieme.
 */
const STROKE = 1.75;

/** Avvolge un'icona di lucide per imporle la taglia e il tratto di sistema. */
const make = (Base, name) => {
  // Questo file e' un barile di icone, non un modulo di componenti: esporta un
  // oggetto, e il fast refresh non ha niente da aggiornare.
  // eslint-disable-next-line react-refresh/only-export-components
  const Wrapped = forwardRef(function FinIcon({ size = ICON.sm, strokeWidth = STROKE, ...rest }, ref) {
    return <Base ref={ref} size={size} strokeWidth={strokeWidth} {...rest} />;
  });
  Wrapped.displayName = `Icon.${name}`;
  return Wrapped;
};

export const Icon = {
  Home:         make(LayoutDashboard, "Home"),
  Settings:     make(Settings, "Settings"),
  Logout:       make(LogOut, "Logout"),
  Menu:         make(Menu, "Menu"),
  Close:        make(X, "Close"),
  Sun:          make(Sun, "Sun"),
  Moon:         make(Moon, "Moon"),
  Globe:        make(Globe, "Globe"),
  Left:         make(ChevronLeft, "Left"),
  Right:        make(ChevronRight, "Right"),
  Up:           make(ChevronUp, "Up"),
  Down:         make(ChevronDown, "Down"),
  Check:        make(Check, "Check"),
  Warning:      make(AlertTriangle, "Warning"),
  Info:         make(Info, "Info"),
  Mail:         make(Mail, "Mail"),
  Accounts:     make(Wallet, "Accounts"),
  Transactions: make(ArrowLeftRight, "Transactions"),
  Transfer:     make(ArrowLeftRight, "Transfer"),
  Savings:      make(PiggyBank, "Savings"),
  Investments:  make(TrendingUp, "Investments"),
  Taxes:        make(Receipt, "Taxes"),
  Documents:    make(FileText, "Documents"),
  Categories:   make(Tags, "Categories"),
  Profile:      make(User, "Profile"),
  Show:         make(Eye, "Show"),
  Hide:         make(EyeOff, "Hide"),
  Edit:         make(Pencil, "Edit"),
  Archive:      make(Archive, "Archive"),
  Unarchive:    make(ArchiveRestore, "Unarchive"),
  Plus:         make(Plus, "Plus"),
  Delete:       make(Trash2, "Delete"),
  Filters:      make(SlidersHorizontal, "Filters"),
  Search:       make(Search, "Search"),
  Refresh:      make(RefreshCw, "Refresh"),
};
