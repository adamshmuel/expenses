// The public tutorial — docs/specs/12-how-to-use.md. No route on the server,
// no request, no user data: everything here is fixed, invented content, the
// same for every visitor, logged in or not.
//
// Each lesson's animation is the real chat/dashboard markup (ChatScreen,
// CategoryBreakdown, DashboardTotals) replaying scripted data on a timer —
// never a drawn or recorded copy of the UI (spec §4).
import { Link } from 'react-router-dom'
import { useAppSelector } from '../store/hooks'
import { ChatScreen } from './ChatScreen'
import { CategoryBreakdown } from './CategoryBreakdown'
import { TutorialLesson } from './TutorialLesson'
import { TutorialSequencerProvider } from '../hooks/useTutorialSequencer'
import { useTypedText, typingDurationMs } from '../hooks/useTypedText'

// A short human pause after the sentence is fully typed, before the lesson
// sends it — the composer step holds for typing time + this pause.
const TYPING_PAUSE_MS = 250
import type { ChatMessageItem, PendingAction } from '../store/chatSlice'

// ---------------------------------------------------------------------------
// Lesson 1 — Record an expense
// ---------------------------------------------------------------------------

const RECORD_SENTENCE = 'spent 50 at the supermarket'

const recordExpensePending: PendingAction = {
  intent: 'create-expense',
  drafts: [{ amount: 50, store: 'Supermarket', category: 'Groceries', date: '2026-09-15' }],
}

const RECORD_EMPTY_HINT = `Nothing here yet. Try “${RECORD_SENTENCE}.”`

const RecordExpenseFrame = ({ step, isActive, frameId }: { step: number; isActive: boolean; frameId: string }) => {
  const typed = useTypedText(RECORD_SENTENCE, step === 0 && isActive, typingDurationMs(RECORD_SENTENCE))

  const messages: ChatMessageItem[] =
    step >= 2 ? [{ id: 'u1', role: 'user', text: RECORD_SENTENCE }, { id: 'a1', role: 'assistant', text: 'Got it — add this?' }] : []
  if (step >= 4) messages.push({ id: 'a2', role: 'assistant', text: 'Done.' })

  return (
    <ChatScreen
      messages={messages}
      pending={step >= 2 && step < 4 ? recordExpensePending : null}
      inputValue={step === 0 ? typed : step === 1 ? RECORD_SENTENCE : ''}
      isSending={step === 1}
      isConfirming={step === 3}
      readOnly
      inputId={frameId}
      emptyStateHint={RECORD_EMPTY_HINT}
    />
  )
}

// ---------------------------------------------------------------------------
// Lesson 2 — Fix a mistake
// ---------------------------------------------------------------------------

const EDIT_SENTENCE = 'change the coffee to 22'

const editExpensePending: PendingAction = {
  intent: 'edit-expense',
  matches: [{ _id: 'e1', amount: 12, store: 'Coffee shop', date: '2026-09-12' }],
  changes: { amount: 22 },
  selectedId: 'e1',
}

const EDIT_EMPTY_HINT = `Nothing here yet. Try “${EDIT_SENTENCE}.”`

const FixMistakeFrame = ({ step, isActive, frameId }: { step: number; isActive: boolean; frameId: string }) => {
  const typed = useTypedText(EDIT_SENTENCE, step === 0 && isActive, typingDurationMs(EDIT_SENTENCE))

  const messages: ChatMessageItem[] =
    step >= 2 ? [{ id: 'u1', role: 'user', text: EDIT_SENTENCE }, { id: 'a1', role: 'assistant', text: 'Change it to 22?' }] : []
  if (step >= 4) messages.push({ id: 'a2', role: 'assistant', text: 'Done.' })

  return (
    <ChatScreen
      messages={messages}
      pending={step >= 2 && step < 4 ? editExpensePending : null}
      inputValue={step === 0 ? typed : step === 1 ? EDIT_SENTENCE : ''}
      isSending={step === 1}
      isConfirming={step === 3}
      readOnly
      inputId={frameId}
      emptyStateHint={EDIT_EMPTY_HINT}
    />
  )
}

// ---------------------------------------------------------------------------
// Lesson 3 — Organise your categories
// ---------------------------------------------------------------------------

const CATEGORY_SENTENCE = 'add a subcategory called Pets under Home'

const createCategoryPending: PendingAction = {
  intent: 'create-category',
  draft: { name: 'Pets', parent: 'Home' },
}

const nestedCategoryGroups = [{ id: 'home', name: 'Home', amount: 0, subs: [{ id: 'pets', name: 'Pets', amount: 0 }] }]

const CATEGORY_EMPTY_HINT = `Nothing here yet. Try “${CATEGORY_SENTENCE}.”`

const OrganiseCategoriesFrame = ({ step, isActive, frameId }: { step: number; isActive: boolean; frameId: string }) => {
  const typed = useTypedText(CATEGORY_SENTENCE, step === 0 && isActive, typingDurationMs(CATEGORY_SENTENCE))

  if (step >= 4) {
    return <CategoryBreakdown groups={nestedCategoryGroups} total={0} openGroups={{ home: true }} onToggle={() => {}} />
  }

  const messages: ChatMessageItem[] =
    step >= 2 ? [{ id: 'u1', role: 'user', text: CATEGORY_SENTENCE }, { id: 'a1', role: 'assistant', text: 'Add this category?' }] : []

  return (
    <ChatScreen
      messages={messages}
      pending={step >= 2 ? createCategoryPending : null}
      inputValue={step === 0 ? typed : step === 1 ? CATEGORY_SENTENCE : ''}
      isSending={step === 1}
      isConfirming={step === 3}
      readOnly
      inputId={frameId}
      emptyStateHint={CATEGORY_EMPTY_HINT}
    />
  )
}

// ---------------------------------------------------------------------------
// Example sentences (spec §3.3) — real phrasings the parser handles.
// ---------------------------------------------------------------------------

const EXAMPLE_SENTENCES = [
  'spent 45 on groceries at Shufersal',
  '32.50 for gas yesterday',
  'add a category called Subscriptions',
  'change the rent to 4200',
  'delete the coffee expense from this morning',
  'reset my categories to the defaults',
]

export const HowToUsePage = () => {
  const user = useAppSelector((state) => state.auth.user)

  return (
    <main className="tutorial-page">
      <section className="tutorial-hero">
        <h1>How to use Expenses</h1>
        <p>
          You write what happened, in plain words, and confirm it before anything is saved — nothing changes the
          moment you send a message.
        </p>
      </section>

      <div className="tutorial-lessons">
        <TutorialSequencerProvider>
          <TutorialLesson
            title="Record an expense"
            description="Type what you spent, the way you'd say it out loud. The app drafts an expense and waits for you to confirm it."
            caption="Type a sentence like “spent 50 at the supermarket,” send it, and the app drafts an expense with an amount, a store and a category. Nothing is saved until you press Confirm."
            frameCount={5}
            durations={[typingDurationMs(RECORD_SENTENCE) + TYPING_PAUSE_MS, 500, 1600, 600, 0]}
            // Step 2 is the draft-and-Confirm step — spec §4's stacked
            // reduced-motion pair needs that, not just the final "Done.".
            reducedMotionSteps={[2, 4]}
            renderFrame={(step, _playToken, isActive, frameId) => (
              <RecordExpenseFrame step={step} isActive={isActive} frameId={frameId} />
            )}
          />

          <TutorialLesson
            title="Fix a mistake"
            description="Describe the expense in words — the app finds it and shows exactly what will change, before you confirm."
            caption="Say “change the coffee to 22” and the app finds the matching expense and shows the change before you confirm it. Deleting works the same way — say what to remove."
            frameCount={5}
            durations={[typingDurationMs(EDIT_SENTENCE) + TYPING_PAUSE_MS, 500, 1600, 600, 0]}
            reducedMotionSteps={[2, 4]}
            renderFrame={(step, _playToken, isActive, frameId) => (
              <FixMistakeFrame step={step} isActive={isActive} frameId={frameId} />
            )}
          />

          <TutorialLesson
            title="Organise your categories"
            description="Categories are edited in the chat too, in their own words — separate from your expenses."
            caption="Say “add a subcategory called Pets under Home” to create it. Renaming, deleting and “reset my categories to the defaults” all work the same way."
            frameCount={5}
            durations={[typingDurationMs(CATEGORY_SENTENCE) + TYPING_PAUSE_MS, 500, 1400, 600, 0]}
            renderFrame={(step, _playToken, isActive, frameId) => (
              <OrganiseCategoriesFrame step={step} isActive={isActive} frameId={frameId} />
            )}
          />

          <article className="lesson">
            <h2>See where it went</h2>
            <p className="lesson__text">
              The dashboard shows what you&rsquo;ve already saved — your total spending and a category breakdown
              you can expand for the details. It only displays; every change still happens in the chat.
            </p>
            <Link to="/dashboard" className="button button--primary lesson__dashboard-link">
              Open the dashboard
            </Link>
          </article>
        </TutorialSequencerProvider>
      </div>

      <section className="tutorial-examples" aria-label="Sentences that work">
        <h2>Sentences that work</h2>
        <ul>
          {EXAMPLE_SENTENCES.map((sentence) => (
            <li key={sentence}>“{sentence}”</li>
          ))}
        </ul>
      </section>

      <section className="tutorial-cta">
        {user ? (
          <>
            <p>Ready to try it with your own expenses?</p>
            <Link to="/home" className="button button--primary">
              Go to the chat
            </Link>
          </>
        ) : (
          <>
            <p>Ready to try it yourself?</p>
            <Link to="/signup" className="button button--primary">
              Sign up
            </Link>
          </>
        )}
      </section>
    </main>
  )
}
