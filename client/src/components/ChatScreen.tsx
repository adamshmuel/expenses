// Extracted from HomePage: everything below the "Chat" heading — the message
// thread, the confirm card, and the composer. Purely presentational (no
// Redux, no network) so the "How to use" tutorial can render the exact same
// markup and classes from a scripted sequence instead of a live conversation.
// HomePage supplies real data and handlers; the tutorial supplies scripted
// data and no-op handlers.
import type { FormEvent, RefObject } from 'react'
import type { ExpenseMatch } from '../api/types'
import { isSaneText, type ChatMessageItem, type PendingAction } from '../store/chatSlice'
import { AlertIcon } from './icons'
// Same formatter the dashboard uses — the dashboard is where the user reads
// money most (totals, category breakdown, the recent-expenses table), so its
// spelling ("₪ 1,234.50", with a separator) is the one that wins; the chat
// used to spell the same amount "₪1234.50".
import { money } from '../lib/dashboardFormat'

const shortDate = (date: string) => date.slice(0, 10)

// Only a free-text field that passes isSaneText is trusted for display —
// bug 2: the AI's store/description text is never guaranteed sane, so a
// leaked JSON/HTML fragment falls back to a safe label instead of rendering.
const saneOrFallback = <T extends string | undefined>(value: string | null | undefined, fallback: T) =>
  isSaneText(value) ? (value ?? undefined) : fallback

const describeExpense = (expense: ExpenseMatch) =>
  `${saneOrFallback(expense.store, undefined) ?? saneOrFallback(expense.description, undefined) ?? 'Expense'} — ${money(expense.amount)} — ${shortDate(expense.date)}`

// A change's value can be the AI's free text (store/description/category
// name) — same bug 2 guard applies before it reaches the DOM.
const describeChanges = (changes: Record<string, unknown>) =>
  Object.entries(changes)
    .map(([field, value]) => `${field} to ${typeof value === 'string' ? saneOrFallback(value, '(unreadable value)') : value}`)
    .join(', ')

/** True once there is a concrete change ready to send — false while several
 *  matches are still waiting for the user to pick one. */
const isReadyToConfirm = (pending: PendingAction) =>
  !('matches' in pending) || pending.selectedId != null

const renderPending = (pending: PendingAction, onSelectMatch: (id: string) => void) => {
  switch (pending.intent) {
    case 'create-expense':
      return (
        <ol className="chat-drafts" aria-label="Expenses to add">
          {pending.drafts.map((draft, index) => (
            <li key={index}>
              {saneOrFallback(draft.store, undefined) ?? saneOrFallback(draft.description, undefined) ?? 'Expense'}{' '}
              — {saneOrFallback(draft.category, 'Category')} —{' '}
              <span className="figure">{money(draft.amount as number)}</span>
              {draft.date && <> — {shortDate(draft.date)}</>}
            </li>
          ))}
        </ol>
      )

    case 'create-category': {
      const name = saneOrFallback(pending.draft.name, 'Category')
      const parent = saneOrFallback(pending.draft.parent, undefined)
      return <p>{parent ? `${name}, under ${parent}` : name}</p>
    }

    case 'edit-expense':
    case 'delete-expense': {
      if (pending.selectedId == null) {
        return (
          <ol className="chat-matches">
            {pending.matches.map((match) => (
              <li key={match._id}>
                <button type="button" className="button button--plain" onClick={() => onSelectMatch(match._id)}>
                  {describeExpense(match)}
                </button>
              </li>
            ))}
          </ol>
        )
      }
      const match = pending.matches.find((candidate) => candidate._id === pending.selectedId)!
      return pending.intent === 'edit-expense' ? (
        <p>
          Change {describeExpense(match)} — {describeChanges(pending.changes)}?
        </p>
      ) : (
        <p>Delete {describeExpense(match)}?</p>
      )
    }

    case 'edit-category':
    case 'delete-category': {
      if (pending.selectedId == null) {
        return (
          <ol className="chat-matches">
            {pending.matches.map((match) => (
              <li key={match._id}>
                <button type="button" className="button button--plain" onClick={() => onSelectMatch(match._id)}>
                  {saneOrFallback(match.name, 'Category')}
                </button>
              </li>
            ))}
          </ol>
        )
      }
      const match = pending.matches.find((candidate) => candidate._id === pending.selectedId)!
      const matchName = saneOrFallback(match.name, 'Category')
      return pending.intent === 'edit-category' ? (
        <p>
          Rename "{matchName}" to "{saneOrFallback(pending.changes.name as string, 'Category')}"?
        </p>
      ) : (
        <p>Delete category "{matchName}"?</p>
      )
    }

    case 'reset-categories':
      return <p>Reset all your categories to the defaults? Expenses in removed categories move to "Other".</p>
  }
}

export interface ChatScreenProps {
  messages: ChatMessageItem[]
  pending: PendingAction | null
  error?: string | null
  isSending?: boolean
  isConfirming?: boolean
  inputValue: string
  onInputChange?: (value: string) => void
  onSubmit?: (event: FormEvent) => void
  onSelectMatch?: (id: string) => void
  onConfirm?: () => void
  onCancel?: () => void
  /** The tutorial's animation replays a scripted conversation — the input and
   *  the confirm/cancel controls are decorative there, not real. */
  readOnly?: boolean
  scrollRef?: RefObject<HTMLDivElement | null>
  bottomRef?: RefObject<HTMLDivElement | null>
  /** The composer input's id (and its label's `htmlFor`). Defaults to
   *  `chat-input`, the real `/home` chat's id. The tutorial page mounts many
   *  `ChatScreen`s at once (every animation frame, stacked, per lesson) and
   *  must give each its own id — a repeated id is invalid HTML and can
   *  misdirect a label or screen reader. */
  inputId?: string
  /** Shown in place of the message thread before anything has been sent.
   *  Defaults to the real chat's generic hint; the tutorial passes each
   *  lesson's own example sentence so a lesson waiting its turn doesn't show
   *  another lesson's instructions. */
  emptyStateHint?: string
  /** A short line above `emptyStateHint`, telling a first-time user what the
   *  chat is for. Only the real `/home` chat passes this — the tutorial's
   *  lessons already have their own heading and caption around the frame, so
   *  they render without it, unchanged. */
  emptyStateInvite?: string
}

export const ChatScreen = ({
  messages,
  pending,
  error,
  isSending = false,
  isConfirming = false,
  inputValue,
  onInputChange,
  onSubmit,
  onSelectMatch,
  onConfirm,
  onCancel,
  readOnly = false,
  scrollRef,
  bottomRef,
  inputId = 'chat-input',
  emptyStateHint = 'Nothing here yet. Try “spent 50 at the supermarket.”',
  emptyStateInvite,
}: ChatScreenProps) => {
  const hasMessages = messages.length > 0

  return (
    <>
      {hasMessages && (
        <div className="chat-scroll" ref={scrollRef}>
          <ol className="chat-thread" aria-label="Conversation">
            {messages.map((message) => (
              <li key={message.id} className={`chat-bubble chat-bubble--${message.role}`}>
                {message.text}
              </li>
            ))}
          </ol>
        </div>
      )}

      {!hasMessages && emptyStateInvite && <p className="chat-empty__invite">{emptyStateInvite}</p>}
      {!hasMessages && <p className="chat-empty">{emptyStateHint}</p>}

      <div className={`chat-bottom${hasMessages ? ' chat-bottom--docked' : ''}`} ref={bottomRef}>
        {error && (
          <div className="banner banner--error" role="alert">
            <AlertIcon />
            <span>{error}</span>
          </div>
        )}

        {pending && (
          <div className="card chat-confirm">
            {renderPending(pending, onSelectMatch ?? (() => {}))}
            <div className="chat-confirm__actions">
              {isReadyToConfirm(pending) && (
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={onConfirm}
                  disabled={isConfirming}
                >
                  {isConfirming ? 'Confirming…' : 'Confirm'}
                </button>
              )}
              <button type="button" className="button button--plain" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <form className="chat-form" onSubmit={onSubmit}>
          <label htmlFor={inputId} className="chat-form__label">
            Message
          </label>
          <input
            id={inputId}
            className="input"
            value={inputValue}
            onChange={(event) => onInputChange?.(event.target.value)}
            disabled={isSending}
            readOnly={readOnly}
            autoComplete="off"
            placeholder="Write it the way you would say it."
          />
          <button type="submit" className="button button--primary" disabled={readOnly || isSending || !inputValue.trim()}>
            {isSending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </div>
    </>
  )
}
