// src/components/Modal.jsx
// Ora e' un guscio sottile attorno a <Sheet variant="dialog">.
//
// Prima erano due componenti diversi che facevano la stessa cosa: Modal (nove
// schermate) e Sheet (quattro). Due pannelli con due raggi, due bordi, due
// animazioni e due comportamenti da tastiera — Sheet intrappolava il focus e
// lo restituiva alla chiusura, Modal no. Aprire un modulo da Conti e uno da
// Movimenti dava due esperienze diverse, e una delle due era peggiore.
//
// Tenendo il nome e la firma, le nove schermate che lo usano hanno preso la
// forma nuova (e la gestione corretta del focus) senza essere toccate.
import Sheet from "../ui/Sheet.jsx";

export default function Modal({ title, onClose, children, footer }) {
  return (
    <Sheet variant="dialog" title={title} onClose={onClose} footer={footer}>
      {children}
    </Sheet>
  );
}
