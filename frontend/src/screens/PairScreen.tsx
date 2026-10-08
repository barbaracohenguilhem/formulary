import { Screen, screenStyles as sh } from '../components/Screen';
import { LabelCap, LabelFrame, LabelName, LabelSub, Notes } from '../components/Label';
import { Button, buttonStyles as b } from '../components/Button';
import { Reg } from '../components/Reg';
import type { Pairing } from '../store/model';

/**
 * A device joins once. It says who it belongs to, shows two words, and waits while a
 * member allows it from their own Formulary. Then it keeps its session: no email, no
 * code, no password — ever again on this device.
 */
export function PairScreen({
  pair,
  onWho,
  onAgain,
}: {
  pair: Pairing;
  onWho: (who: 'carla' | 'barbara') => void;
  onAgain: () => void;
}) {
  const other = pair.who === 'barbara' ? 'carla' : 'barbara';
  const head = (
    <div className={sh.lotbar}>
      <span>
        formulary
        <Reg />
      </span>
      <span className={sh.lot}>join</span>
    </div>
  );

  if (pair.phase === 'who' || pair.phase === 'asking') {
    return (
      <Screen head={head}>
        <LabelFrame>
          <LabelCap>this device</LabelCap>
          <LabelName>who is this?</LabelName>
          <LabelSub>it joins once · no password</LabelSub>
          <Notes>{pair.note ?? 'choose who uses this device. the other one allows it from their formulary, and it stays signed in from then on.'}</Notes>
        </LabelFrame>
        <div className={[b.stack, b.afterAction].join(' ')}>
          <Button variant="outline" disabled={pair.phase === 'asking'} onClick={() => onWho('carla')}>
            {pair.phase === 'asking' && pair.who === 'carla' ? 'asking…' : 'i’m carla'}
          </Button>
          <Button variant="outline" disabled={pair.phase === 'asking'} onClick={() => onWho('barbara')}>
            {pair.phase === 'asking' && pair.who === 'barbara' ? 'asking…' : 'i’m barbara'}
          </Button>
        </div>
      </Screen>
    );
  }

  if (pair.phase === 'waiting') {
    return (
      <Screen head={head}>
        <LabelFrame>
          <LabelCap>asking to join</LabelCap>
          <LabelName>{pair.words ?? ''}</LabelName>
          <LabelSub>{`waiting for ${other} to allow it`}</LabelSub>
          <Notes>{`${other}’s formulary shows that this device asks to join. ${other} types these two words there and taps allow — then this opens by itself.`}</Notes>
        </LabelFrame>
        <div className={[b.stack, b.afterAction].join(' ')}>
          <Button variant="quiet" onClick={onAgain}>
            start again
          </Button>
        </div>
      </Screen>
    );
  }

  const line = pair.phase === 'denied' ? 'this device was turned away' : pair.phase === 'expired' ? 'the ask timed out' : pair.note ?? 'something went wrong';
  return (
    <Screen head={head}>
      <LabelFrame>
        <LabelCap>not joined</LabelCap>
        <LabelName>{pair.phase === 'denied' ? 'turned away' : 'try again'}</LabelName>
        <LabelSub>{line}</LabelSub>
      </LabelFrame>
      <div className={[b.stack, b.afterAction].join(' ')}>
        <Button variant="outline" onClick={onAgain}>
          start again
        </Button>
      </div>
    </Screen>
  );
}
