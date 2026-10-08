import { useState } from 'react';
import s from './Join.module.css';
import type { JoinAsk } from '../store/model';

type Decide = (id: string, words: string | null) => Promise<boolean>;

/**
 * A device asking to join. Its words are never shown here: she types the two words the
 * new phone shows, so an ask from a stranger can't be allowed by a stray tap.
 */
export function JoinRequests({ joins, onDecide }: { joins: JoinAsk[]; onDecide: Decide }) {
  if (joins.length === 0) return null;
  return (
    <>
      {joins.map((j) => (
        <JoinCard key={j.id} ask={j} onDecide={onDecide} />
      ))}
    </>
  );
}

function JoinCard({ ask, onDecide }: { ask: JoinAsk; onDecide: Decide }) {
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = words.trim().split(/[^A-Za-z]+/).filter(Boolean).length === 2;

  const decide = async (typed: string | null) => {
    setBusy(true);
    const done = await onDecide(ask.id, typed);
    setBusy(false);
    if (!done) setWords('');
  };

  return (
    <section className={s.join} aria-label={`${ask.who}’s ${ask.label} asks to join`}>
      <div className={s.head}>
        <span>{`${ask.who}’s ${ask.label} asks to join`}</span>
        <span>{new Date(ask.createdAt).toTimeString().slice(0, 5)}</span>
      </div>
      <label className={s.ask}>
        <span className={s.hint}>type the two words on that phone</span>
        <input
          className={s.words}
          value={words}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ready && !busy && void decide(words)}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          maxLength={40}
          placeholder="— —"
        />
      </label>
      <div className={s.acts}>
        <button type="button" className={s.act} disabled={busy} onClick={() => void decide(null)}>
          turn away
        </button>
        <button type="button" className={[s.act, s.allow].join(' ')} disabled={busy || !ready} onClick={() => void decide(words)}>
          allow
        </button>
      </div>
    </section>
  );
}
