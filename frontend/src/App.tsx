import s from './App.module.css';
import { useFormulary } from './store/useFormulary';
import { IndexScreen } from './screens/IndexScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { LabelScreen } from './screens/LabelScreen';
import { SlipScreen } from './screens/SlipScreen';
import { ComposeScreen } from './screens/ComposeScreen';
import { PairScreen } from './screens/PairScreen';
import { Toast } from './components/Toast';

export default function App() {
  const { state, selected, view, nextLot, actions } = useFormulary();
  // today is read fresh on every render, so a lot finished at 23:59 still reads right
  const now = new Date();
  const barbara = state.who === 'barbara';

  return (
    <div className={s.desk}>
      <main className={s.column}>
        {state.pair && <PairScreen pair={state.pair} onWho={(who) => void actions.pairAs(who)} onAgain={actions.pairAgain} />}

        {!state.pair && state.screen === 'list' && barbara && (
          <ReviewScreen
            tasks={state.tasks}
            capped={state.archiveCapped}
            now={now}
            sync={state.sync}
            failure={state.failure}
            pending={state.pending}
            joins={state.joins}
            onDecideJoin={actions.decideJoin}
            onOpen={actions.open}
            onSync={actions.refreshReview}
          />
        )}

        {!state.pair && state.screen === 'list' && !barbara && (
          // keyed on the tab so switching tabs replays `rise`
          <IndexScreen
            key={state.tab}
            view={view}
            tab={state.tab}
            now={now}
            mode={state.mode}
            sync={state.sync}
            failure={state.failure}
            robot={state.robot}
            archiveCapped={state.archiveCapped}
            showAll={state.showAll}
            pending={state.pending}
            connected={state.mode === 'seed' || state.connected}
            canWrite={state.mode === 'seed' ? true : state.canWrite}
            backend={state.backend}
            joins={state.joins}
            onDecideJoin={state.backend === 'cloud' ? actions.decideJoin : undefined}
            onConnectGmail={() => void actions.connectGmail()}
            onTab={actions.setTab}
            onCompose={actions.compose}
            onOpen={actions.open}
            onToggle={actions.toggleDone}
            onSync={actions.sync}
            onToggleShowAll={actions.toggleShowAll}
          />
        )}

        {!state.pair && state.screen === 'detail' && selected && (
          <LabelScreen
            key={selected.id}
            task={selected}
            who={state.who}
            actedAt={state.acted[selected.id]}
            saving={!!state.pending[selected.id]}
            robot={state.mode === 'inbox' ? state.robot : undefined}
            canWrite={state.mode === 'inbox' ? state.canWrite : true}
            onBack={actions.back}
            onToggleDone={() => actions.toggleDone(selected)}
            onComplete={() => actions.complete(selected)}
            onPrepare={() => actions.prepare(selected)}
            onAct={() => actions.act(selected)}
            onHandBack={(recipient, tone) => actions.handoff(selected, recipient, tone)}
            onDiscard={() => actions.discard(selected)}
            onReturnProposal={(proposal) => actions.returnProposal(selected, proposal)}
          />
        )}

        {!state.pair && !barbara && state.screen === 'handoff' && selected && (
          <SlipScreen
            task={selected}
            slip={state.slip}
            recording={state.recording}
            recordingBusy={state.recordingBusy}
            level={state.level}
            mode={state.mode}
            saving={!!state.pending[selected.id]}
            onCancel={() => {
              actions.record(false);
              actions.open(selected);
            }}
            onPatch={actions.patchSlip}
            onRecord={actions.record}
            onAddFiles={actions.addFeedbackFiles}
            onRemoveFile={actions.removeFeedbackFile}
            onHand={actions.hand}
          />
        )}

        {!state.pair && !barbara && state.screen === 'compose' && (
          <ComposeScreen
            nextLot={nextLot}
            draft={state.draft}
            mode={state.mode}
            saving={!!state.pending.new}
            onCancel={actions.back}
            onPatch={actions.patchDraft}
            onCreate={() => void actions.create()}
          />
        )}

        <Toast text={state.toast} />
      </main>
    </div>
  );
}
