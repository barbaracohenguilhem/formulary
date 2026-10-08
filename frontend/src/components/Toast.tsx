import s from './Toast.module.css';

export function Toast({ text }: { text: string | null }) {
  return (
    <div className={[s.toast, text ? s.show : ''].join(' ')} aria-live="polite">
      {text}
    </div>
  );
}
