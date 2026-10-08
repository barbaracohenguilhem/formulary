import s from '../components/Slip.module.css';
import { Screen, LotBar } from '../components/Screen';
import { LabelCap, LabelFrame } from '../components/Label';
import { Button, buttonStyles as b } from '../components/Button';
import type { Task } from '../types';
import type { Mode, SlipDraft } from '../store/model';
import { BARS } from '../store/model';
import { STUDIO } from '../data/seed';
import { timerLabel } from '../lib/format';

const PLACEHOLDER_STUDIO =
  'how should i proceed? where to look first, what it must contain, who signs it off.';
const PLACEHOLDER_INBOX =
  'how should this be handled? what to change in the reply, what it must contain, who signs it off.';

const dictationAvailable = () =>
  typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export function SlipScreen({
  task,
  slip,
  recording,
  level,
  mode,
  saving,
  onCancel,
  onPatch,
  onRecord,
  onHand,
}: {
  task: Task;
  slip: SlipDraft;
  recording: boolean;
  level: number[];
  mode: Mode;
  saving?: boolean;
  onCancel: () => void;
  onPatch: (patch: Partial<SlipDraft>) => void;
  onRecord: (on: boolean) => void;
  onHand: () => void;
}) {
  const inbox = mode === 'inbox';
  // on an inbox lot the note is kept as text, so a voice note is dictation — only where the browser can
  const canDictate = !inbox || dictationAvailable();
  const voice = slip.mode === 'voice' && canDictate;
  const hasAudio = slip.secs > 0;
  const hasNote = slip.note.trim().length > 0;
  const ready = inbox ? hasNote && !recording && !saving : voice ? hasAudio : hasNote;
  const live = recording || hasAudio;

  const recipient = inbox ? 'to barbara' : `to ${STUDIO}`;
  const primary = saving
    ? 'saving…'
    : inbox
      ? 'send feedback to barbara →'
      : `hand to ${STUDIO} →`;
  const recordLabel = recording
    ? 'stop'
    : inbox
      ? hasNote
        ? 'dictate more'
        : 'start dictation'
      : hasAudio
        ? 're-record'
        : 'start recording';

  return (
    <Screen head={<LotBar back="cancel" onBack={onCancel} id={task.lot} />}>
      <LabelFrame variant="slip">
        <LabelCap>instruction slip</LabelCap>
        <h1 className={s.name}>{task.title}</h1>
        <div className={s.to}>{recipient}</div>

        {canDictate && (
          <div className={s.modes}>
            {(['voice', 'written'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={slip.mode === m}
                className={[s.mode, slip.mode === m ? s.modeOn : ''].join(' ')}
                onClick={() => {
                  if (m !== 'voice' && recording) onRecord(false);
                  onPatch({ mode: m });
                }}
              >
                {m === 'voice' ? inbox ? 'dictate' : 'voice note' : 'written'}
              </button>
            ))}
          </div>
        )}

        {voice ? (
          <div className={s.voice}>
            <div className={s.wave} aria-hidden="true">
              {Array.from({ length: BARS }, (_, i) => (
                <span
                  key={i}
                  className={[s.bar, live ? s.barLive : ''].join(' ')}
                  style={{ height: `${Math.max(4, level[i] ?? 0)}px` }}
                />
              ))}
            </div>
            <div className={s.timer}>{timerLabel(slip.secs)}</div>
            {inbox && (
              <div className={[s.transcript, hasNote ? '' : s.transcriptHint].join(' ')}>
                {hasNote ? slip.note : recording ? 'listening…' : 'Speak your feedback. Barbara receives the transcript.'}
              </div>
            )}
            <button
              type="button"
              className={[s.record, recording ? s.recordOn : ''].join(' ')}
              onClick={() => onRecord(!recording)}
            >
              {recordLabel}
            </button>
          </div>
        ) : (
          <textarea
            id="slip-note"
            aria-label={inbox ? 'feedback for barbara' : 'instructions'}
            className={s.textarea}
            placeholder={inbox ? PLACEHOLDER_INBOX : PLACEHOLDER_STUDIO}
            value={slip.note}
            rows={5}
            maxLength={inbox ? 4000 : undefined}
            autoFocus
            onChange={(e) => onPatch({ note: e.target.value, mode: 'written' })}
          />
        )}

        {!inbox && (
          <button
            type="button"
            role="checkbox"
            aria-checked={slip.approval}
            className={s.approval}
            onClick={() => onPatch({ approval: !slip.approval })}
          >
            <span className={[s.box, slip.approval ? s.boxOn : ''].join(' ')} />
            <span className={s.approvalLabel}>return to me for approval</span>
          </button>
        )}
      </LabelFrame>

      <Button variant="solid" className={b.handOff} disabled={!ready} onClick={onHand}>
        {primary}
      </Button>
    </Screen>
  );
}
