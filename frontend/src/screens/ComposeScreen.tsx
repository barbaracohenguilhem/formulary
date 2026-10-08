import { useRef } from 'react';
import s from '../components/Compose.module.css';
import { Screen, LotBar } from '../components/Screen';
import { LabelCap, LabelFrame } from '../components/Label';
import { Button, buttonStyles as b } from '../components/Button';
import type { Context } from '../types';
import type { Draft, DueChoice, Mode } from '../store/model';
import { COMPOSE_CONTEXTS } from '../lib/inbox';
import { estLabel } from '../lib/format';

const CONTEXTS: Context[] = ['studio', 'work', 'home', 'errands'];
const DUES: DueChoice[] = ['today', 'tomorrow', 'this week', 'someday'];
const ESTIMATES = [5, 15, 30, 60];

export function ComposeScreen({
  nextLot,
  draft,
  mode,
  saving,
  onCancel,
  onPatch,
  onCreate,
}: {
  nextLot: number;
  draft: Draft;
  mode: Mode;
  saving?: boolean;
  onCancel: () => void;
  onPatch: (patch: Partial<Draft>) => void;
  onCreate: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const inbox = mode === 'inbox';
  const contexts: string[] = inbox ? COMPOSE_CONTEXTS.map((c) => c.chip) : CONTEXTS;
  const context = contexts.includes(draft.context) ? draft.context : contexts[0];
  const ready = draft.title.trim().length > 0 && !saving;

  return (
    <Screen head={<LotBar back="cancel" onBack={onCancel} id={nextLot} arrow={false} />}>
      <LabelFrame variant="compose">
        <LabelCap>blank label</LabelCap>

        <input
          id="compose-title"
          ref={input}
          className={s.title}
          value={draft.title}
          placeholder="what needs doing?"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => onPatch({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ready) onCreate();
          }}
        />
        <div className={s.rule} />

        <div>
          <Row label="context">
            {contexts.map((c) => (
              <Chip key={c} on={context === c} onClick={() => onPatch({ context: c })}>
                {c}
              </Chip>
            ))}
          </Row>
          <Row label="due">
            {DUES.map((d) => (
              <Chip key={d} on={draft.due === d} onClick={() => onPatch({ due: d })}>
                {d}
              </Chip>
            ))}
          </Row>
          {!inbox && (
            <Row label="estimate">
              {ESTIMATES.map((m) => (
                <Chip key={m} on={draft.est === m} onClick={() => onPatch({ est: m })}>
                  {estLabel(m)}
                </Chip>
              ))}
            </Row>
          )}
        </div>
      </LabelFrame>

      <Button variant="solid" className={[b.action, b.print].join(' ')} disabled={!ready} onClick={onCreate}>
        {saving ? 'printing…' : 'print label'}
      </Button>
    </Screen>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={s.option}>
      <span className={s.optionKey}>{label}</span>
      <div className={s.chips}>{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} className={[s.chip, on ? s.chipOn : ''].join(' ')} onClick={onClick}>
      {children}
    </button>
  );
}
