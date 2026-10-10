import { useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { CheckCircle2, Circle, Loader2, MinusCircle } from 'lucide-react';
import type { GoalStatus } from './types';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'md' | 'lg' | 'sm';
  icon?: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', icon, children, className = '', ...rest }: BtnProps) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function Card({
  children,
  className = '',
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          {title && <h3>{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  type?: string;
  maxLength?: number;
}

export function Field({ label, value, onChange, hint, multiline, rows = 2, placeholder, type = 'text', maxLength }: FieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea id={id} rows={rows} value={value} placeholder={placeholder} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} type={type} value={value} placeholder={placeholder} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <h2>{title}</h2>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = true,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

export const STATUS_LABEL: Record<GoalStatus, string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
  skipped: 'Skipped',
};
const STATUS_ICON: Record<GoalStatus, ReactNode> = {
  todo: <Circle size={14} aria-hidden />,
  'in-progress': <Loader2 size={14} aria-hidden />,
  done: <CheckCircle2 size={14} aria-hidden />,
  skipped: <MinusCircle size={14} aria-hidden />,
};
export function StatusTag({ status }: { status: GoalStatus }) {
  return (
    <span className={`tag gs-${status}`}>
      {STATUS_ICON[status]}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ProgressRing({ done, total, percent }: { done: number; total: number; percent: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" role="img" aria-label={`${done} of ${total} goals done`}>
      <svg viewBox="0 0 128 128" width="140" height="140" aria-hidden>
        <circle cx="64" cy="64" r={r} className="ring-bg" />
        <circle cx="64" cy="64" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c - (c * percent) / 100} transform="rotate(-90 64 64)" />
      </svg>
      <div className="ring-text">
        <strong>
          {done}/{total}
        </strong>
        <span>goals done</span>
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

// ---------- clipboard / download ----------

export async function copyText(text: string): Promise<'copied' | 'fallback' | 'failed'> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok ? 'fallback' : 'failed';
  } catch {
    return 'failed';
  }
}

export function downloadText(filename: string, text: string, type = 'text/markdown;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
