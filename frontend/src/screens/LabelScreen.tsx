import { useState } from 'react';
import { Screen, LotBar } from '../components/Screen';
import reviewStyles from './ReviewDetail.module.css';
import {
  Block,
  LabelCap,
  LabelFrame,
  LabelName,
  LabelSub,
  Notes,
  Proposal,
  SlipBlock,
  SpecRows,
  ToHand,
  type SpecRow,
} from '../components/Label';
import { ActionButton, Button, buttonStyles as b } from '../components/Button';
import { Reg } from '../components/Reg';
import type { Task } from '../types';
import type { Robot } from '../store/model';
import { OWNER } from '../data/seed';
import { clock, dayLabel, estLabel, stamp, whenOf } from '../lib/format';
import { isBarbaraPending } from '../lib/review';

/**
 * On the seed, actions are simulated (§3): the tap is logged and the receipt line
 * appears, but nothing dials. An inbox lot's action is a real link — the button IS
 * the task.
 */
const EMPTY_NOTES = 'no notes recorded for this lot.';
const EMPTY_SUMMARY = 'no summary recorded for this lot.';

const STATUS = {
  pending: 'to review',
  approved: 'approved · with barbara to carry out',
  changes: 'changes requested',
  barbara: 'with barbara',
} as const;

function specsOf(task: Task, revising: boolean): SpecRow[] {
  const p = task.prepared;
  if (!p) {
    return [
      { k: 'estimate', v: estLabel(task.est ?? 0) },
      { k: 'created', v: task.created },
      { k: 'status', v: task.done && task.doneAt ? `done ${task.doneAt.full}` : 'open' },
      { k: 'prepared for', v: OWNER },
    ];
  }
  const rows: SpecRow[] = [];
  if (p.subject && p.subject.toLowerCase() !== task.title) rows.push({ k: 'subject', v: p.subject, plain: true });
  const received = new Date(p.receivedAt);
  rows.push({ k: p.manual ? 'written' : 'received', v: `${stamp(received)} · ${clock(received)}` });
  if (p.dueAt) {
    const due = new Date(/^\d{4}-\d\d-\d\d$/.test(p.dueAt) ? `${p.dueAt}T00:00:00` : p.dueAt);
    rows.push({ k: 'due', v: p.dueHasTime ? `${dayLabel(due)} · ${clock(due)}` : `${dayLabel(due)}.${due.getFullYear()}` });
  }
  if (p.priority) rows.push({ k: 'priority', v: p.priority });
  if (p.project) rows.push({ k: 'project', v: p.project, plain: true });
  const status = p.completed ? (p.autoFiled ? 'filed by itself · no review' : 'completed') : STATUS[p.review];
  rows.push({ k: 'status', v: revising && p.review === 'changes' ? `${status} · revising` : status });
  rows.push({ k: 'prepared for', v: (p.owner || OWNER).toLowerCase(), plain: !!p.owner });
  return rows;
}

/** What the proposal inset says, and the control it carries, for a lot with no draft yet. */
function draftState(task: Task, robot: Robot, busyHere: boolean) {
  const p = task.prepared!;
  if (p.robot?.state === 'preparing' || (busyHere && robot.phase === 'drafting')) {
    return { text: 'the robot is reading the whole thread…', act: busyHere ? { text: 'stop' } : undefined };
  }
  if (p.unread) return { text: 'the robot couldn’t read this one · open it in gmail', act: robot.able ? { text: 'prepare the reply' } : undefined };
  if (p.draftFail) return { text: p.draftFail, act: robot.able ? { text: 'try again' } : undefined };
  if (p.readied) {
    // the robot read it all and found nothing to send: say which, rather than "not prepared"
    const text = p.blockers ? 'nothing to approve until the blocker above is cleared' : 'nothing to send · the robot found no reply or action to prepare';
    return { text, act: robot.able ? { text: 'draft it again' } : undefined };
  }
  if (!robot.able) return { text: 'not prepared yet · the robot runs on the mailbox owner’s view' };
  return { text: 'not prepared yet', act: { text: 'prepare the reply' } };
}

export function LabelScreen({
  task,
  who,
  actedAt,
  saving,
  robot,
  canWrite,
  onBack,
  onToggleDone,
  onComplete,
  onAct,
  onHandBack,
  onDiscard,
  onPrepare,
  onReturnProposal,
}: {
  task: Task;
  who?: 'carla' | 'barbara' | null;
  actedAt?: string;
  saving?: boolean;
  robot?: Robot;
  canWrite?: boolean | null;
  onBack: () => void;
  onToggleDone: () => void;
  onComplete?: () => void;
  onAct: () => void;
  onHandBack: () => void;
  onDiscard: () => void;
  onPrepare?: () => void;
  onReturnProposal?: (proposal: string) => Promise<boolean>;
}) {
  const p = task.prepared;
  const barbara = who === 'barbara';
  const [editing, setEditing] = useState(false);
  const [proposalDraft, setProposalDraft] = useState('');
  const [proposalVersion, setProposalVersion] = useState<string | undefined>();
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState('');
  const busyHere = !!robot && robot.on === task.id;
  const revising = busyHere && robot!.phase === 'revising';
  const locked = saving || returning || canWrite === false;
  const busyElse = !!robot && robot.phase !== 'idle' && !busyHere;

  const slipFoot =
    task.slip && task.slip.to === 'the robot' && task.slip.status === 'sent'
      ? revising
        ? 'the robot is revising…'
        : robot?.able
          ? 'queued · the robot answers on your next ↻'
          : 'waiting · the robot runs on the mailbox owner’s view'
      : undefined;

  let proposal: JSX.Element | null = null;
  if (p && (!task.done || barbara) && (p.proposal || (!barbara && p.actionRequired && !p.manual && robot))) {
    if (p.proposal && !(busyHere && robot!.phase === 'drafting')) {
      proposal = (
        <Proposal
          label={barbara ? p.review === 'approved' ? 'proposal approved by carla' : 'current proposal' : p.revised ? 'revised proposal · for your approval' : undefined}
          act={!barbara && robot?.able && !revising && p.review === 'pending' ? { text: 'draft it again', onClick: () => onPrepare?.(), disabled: busyElse || locked } : undefined}
        >
          {p.proposal}
        </Proposal>
      );
    } else {
      const d = draftState(task, robot!, busyHere);
      proposal = (
        <Proposal muted act={d.act ? { text: d.act.text, onClick: () => onPrepare?.(), disabled: (busyElse && !busyHere) || (canWrite === false) } : undefined}>
          {d.text}
        </Proposal>
      );
    }
  }

  const approvedAwaiting = !!p && p.review === 'approved' && !p.completed;
  const delegatedManual = !!p && p.review === 'barbara' && p.manual && !p.completed;
  const awaitingBarbara = !!p && !p.completed && (p.review === 'barbara' || p.review === 'changes');
  const feedback = p?.feedback || task.slip?.note;
  const dictated = p?.feedbackMode === 'voice' || task.slip?.mode === 'voice';
  const actionable = isBarbaraPending(task);
  const proposalChanged = editing && proposalVersion !== p?.updatedAt;
  const noLongerWaiting = p?.completed
    ? 'This lot has already been handled.'
    : 'This lot is back with Carla for review.';
  const editConflict = !actionable
    ? `${noLongerWaiting} Your unsaved text is kept below.`
    : proposalChanged
      ? 'This lot changed while you were editing. Your text is kept below. Cancel editing and reopen the editor to review the latest proposal before saving.'
      : '';

  const returnProposal = async () => {
    if (!onReturnProposal || !proposalDraft.trim() || locked || !actionable || proposalChanged) return;
    setReturning(true);
    setReturnError('');
    try {
      if (await onReturnProposal(proposalDraft.trim())) setEditing(false);
      else setReturnError('The revised proposal was not confirmed saved. Your text is kept here.');
    } catch {
      setReturnError('The revised proposal was not confirmed saved. Your text is kept here.');
    } finally {
      setReturning(false);
    }
  };

  return (
    <Screen head={<LotBar back={barbara ? 'handoffs' : 'index'} onBack={onBack} id={task.lot} />}>
      <LabelFrame>
        <LabelCap>
          formulary
          <Reg />
        </LabelCap>
        <LabelName>{task.title}</LabelName>
        <LabelSub>{`${task.context} · ${whenOf(task)}`}</LabelSub>

        <SpecRows rows={specsOf(task, revising)} />

        <Notes>{task.notes || (p ? EMPTY_SUMMARY : EMPTY_NOTES)}</Notes>
        {p?.risk && <Block label="check the sender first">{`${p.risk} · from ${task.refs.find((r) => r.k === 'from')?.v ?? 'an unknown sender'}`}</Block>}
        {p?.deliverable && <Block label="deliverable requested">{p.deliverable}</Block>}
        {p?.blockers && <Block label="unable to complete">{p.blockers}</Block>}
        {proposal}

        <ToHand refs={task.refs} />
        {barbara && feedback ? (
          <Block label={dictated ? 'carla’s dictated feedback · transcript' : 'carla’s instructions'}>{feedback}</Block>
        ) : task.slip ? <SlipBlock slip={task.slip} foot={slipFoot} /> : null}
      </LabelFrame>

      {barbara && !actionable && !editing && <p className={reviewStyles.help} role="status">{noLongerWaiting}</p>}

      {barbara && editing && (
        <section className={reviewStyles.editor} aria-label="Revise proposal">
          <label className={reviewStyles.editLabel} htmlFor="revised-proposal">proposal for carla to review</label>
          <p className={reviewStyles.help}>Update the reply or action below. Carla will review this version before it is carried out.</p>
          {editConflict && <p className={reviewStyles.help} role="alert">{editConflict}</p>}
          <textarea
            className={reviewStyles.textarea}
            id="revised-proposal"
            value={proposalDraft}
            rows={10}
            maxLength={6000}
            autoFocus
            disabled={locked}
            onChange={(event) => setProposalDraft(event.target.value)}
          />
          {returnError && !editConflict && <p className={reviewStyles.help} role="alert">{returnError}</p>}
          <div className={b.stack}>
            <Button variant="solid" disabled={locked || !proposalDraft.trim() || !actionable || proposalChanged} onClick={() => void returnProposal()}>
              {returning ? 'saving…' : 'return proposal to carla →'}
            </Button>
            <Button variant="quiet" disabled={locked} onClick={() => setEditing(false)}>cancel editing</Button>
          </div>
        </section>
      )}

      {task.action && (
        <>
          <ActionButton cta={task.action.cta} href={p ? task.action.target : undefined} onClick={onAct} />
          <div className={b.receipt}>
            {actedAt ? `${task.action.note} at ${actedAt}` : p?.attachments ? 'attachments on the thread' : ''}
          </div>
        </>
      )}

      <div className={[b.stack, task.action ? b.afterAction : ''].join(' ')}>
        {barbara ? (
          <>
            {actionable && !editing && onReturnProposal && (
              <Button variant="outline" disabled={locked} onClick={() => {
                setProposalDraft(p?.proposal || '');
                setProposalVersion(p?.updatedAt);
                setReturnError('');
                setEditing(true);
              }}>
                {p?.proposal ? 'edit proposal for carla' : 'write proposal for carla'}
              </Button>
            )}
            {actionable && (approvedAwaiting || delegatedManual) && onComplete && (
              <>
                <p className={reviewStyles.help}>{delegatedManual ? 'Carry out Carla’s instructions, then mark this task handled here.' : 'Send the approved reply in Gmail or carry out the action, then mark it handled here. This button records completion; it does not send an email.'}</p>
                <Button variant="outline" disabled={locked || editing} onClick={onComplete}>
                  {saving ? 'saving…' : 'mark as handled'}
                </Button>
              </>
            )}
          </>
        ) : (
          <>
            {!awaitingBarbara && (
              <Button variant="outline" disabled={locked} onClick={onToggleDone}>
                {saving ? 'saving…' : task.done ? 'reopen lot' : p ? 'approve for barbara' : 'mark as done'}
              </Button>
            )}
            {awaitingBarbara && <p className={reviewStyles.help}>Your instructions are with Barbara.</p>}
            {!task.done && (
              <Button variant="outline" disabled={locked || revising} onClick={onHandBack}>
                {task.slip && task.slip.status === 'sent' ? 'edit feedback for barbara' : p ? 'give feedback to barbara' : 'hand back with instructions'}
              </Button>
            )}
            {!task.done && !awaitingBarbara && (
              <Button variant="quiet" disabled={locked} onClick={onDiscard}>
                {p ? 'file without approving' : 'discard lot'}
              </Button>
            )}
          </>
        )}
      </div>
    </Screen>
  );
}
