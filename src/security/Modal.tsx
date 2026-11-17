import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export default function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
    return () => { if (dialog?.open) dialog.close(); };
  }, [open]);
  return <dialog ref={ref} aria-labelledby={titleId} className="gg-modal" onCancel={onClose}>
    <div className="gg-modal-head"><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} className="gg-icon-button" aria-label="창 닫기"><X size={21}/></button></div>
    <div className="gg-modal-body">{children}</div>
  </dialog>;
}
