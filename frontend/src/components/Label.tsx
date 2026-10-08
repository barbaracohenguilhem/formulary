import type { ReactNode } from 'react';
import s from './Label.module.css';
import type { Ref, Slip } from '../types';
import { timerLabel } from '../lib/format';

type Variant = 'label' | 'slip' | 'compose';

const variants: Record<Variant, string> = {
  label: '',
  slip: s.frameSlip,
  compose: s.frameCompose,
};

export function LabelFrame({ variant = 'label', children }: { variant?: Variant; children: ReactNode }) {
  return <div className={[s.frame, variants[variant]].join(' ')}>{children}</div>;
}

/** The printed cap of the label — a tracked line over a rule. */
export function LabelCap({ children }: { children: ReactNode }) {
  return (
    <>
      <div className={s.cap}>{children}</div>
      <div className={s.rule} />
    </>
  );
}

export function LabelName({ children }: { children: ReactNode }) {
  return <h1 className={s.name}>{children}</h1>;
}

export function LabelSub({ children }: { children: ReactNode }) {
  return <div className={s.sub}>{children}</div>;
}

export type SpecRow = { k: string; v: string; plain?: boolean };

export function SpecRows({ rows }: { rows: SpecRow[] }) {
  return (
    <div className={s.specs}>
      {rows.map(({ k, v, plain }) => (
        <div className={s.spec} key={k}>
          <span className={s.specKey}>{k}</span>
          <span className={[s.specValue, plain ? s.specPlain : ''].join(' ')}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export function Notes({ children }: { children: string }) {
  return <p className={s.notes}>{children}</p>;
}

/** A titled paragraph the robot prepared: a deliverable, an instruction. */
export function Block({ label, children }: { label: string; children: string }) {
  return (
    <div className={s.block}>
      <div className={s.blockKey}>{label}</div>
      <div className={s.blockText}>{children}</div>
    </div>
  );
}

/**
 * The drafted reply or action, set inset so it can be approved as it stands. While
 * there is none yet, the inset says why in muted mono, and carries the one control
 * that asks the robot for it.
 */
export function Proposal({
  children,
  label = 'for your approval · proposed reply or action',
  muted = false,
  act,
}: {
  children: string;
  label?: string;
  muted?: boolean;
  act?: { text: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className={[s.inset, muted ? s.insetMuted : ''].join(' ')}>
      <div className={s.blockKey}>{label}</div>
      <div className={s.blockText}>{children}</div>
      {act && (
        <button type="button" className={s.insetAct} onClick={act.onClick} disabled={act.disabled}>
          {act.text}
        </button>
      )}
    </div>
  );
}

/**
 * "To hand" — the section that defines the product. Each row is a fact the agent
 * gathered; `source` carries the provenance the production build audits against.
 */
export function ToHand({ refs }: { refs: Ref[] }) {
  if (refs.length === 0) return null;
  return (
    <section className={s.toHand}>
      <div className={[s.cap, s.capMuted].join(' ')}>to hand</div>
      <div className={s.refs}>
        {refs.map((ref) => (
          <div className={s.ref} key={ref.k} title={ref.source?.label}>
            <span className={s.refKey}>{ref.k}</span>
            <span className={s.refValue}>{ref.v}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const slipHead = (slip: Slip) => {
  if (slip.status === 'returned') return 'your instructions';
  if (slip.to === 'barbara') return 'handed to barbara';
  if (slip.to === 'the robot') return 'changes requested';
  return `handed to ${slip.to}`;
};

const slipFoot = (slip: Slip) => {
  if (slip.status === 'returned') return 'revised · back for your approval';
  if (slip.to === 'barbara') return 'waiting on barbara';
  if (slip.to === 'the robot') return 'back with the robot for a new proposal';
  return slip.approval ? 'returns to you for approval' : '';
};

export function SlipBlock({ slip, foot: footOverride }: { slip: Slip; foot?: string }) {
  const body =
    slip.mode === 'voice' && !slip.note
      ? `voice note · ${timerLabel(slip.secs ?? 0)}`
      : slip.note || 'no written instructions';
  const foot = footOverride ?? slipFoot(slip);
  return (
    <div className={s.slip}>
      <div className={s.slipHead}>
        <span>{slipHead(slip)}</span>
        <span>{slip.at || 'carla'}</span>
      </div>
      <div className={s.slipBody}>{body}</div>
      {foot && <div className={s.slipFoot}>{foot}</div>}
    </div>
  );
}

export { s as labelStyles };
