// The AI chat — spec docs/specs/01-ai-chat.md §6-8. The only screen that
// changes anything: every intent goes through a parse (request one) and an
// explicit confirm (request two) before it touches the database.
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import {
  loadChatHistory,
  sendChatMessage,
  confirmChatAction,
  selectMatch,
  cancelPending,
  clearChatError,
  isSaneText,
  type PendingAction,
} from '../store/chatSlice'
import type { ExpenseMatch } from '../api/types'
import { AlertIcon } from './icons'

const money = (amount: number) => `₪${amount.toFixed(2)}`
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

export const HomePage = () => {
  const dispatch = useAppDispatch()
  const { messages, pending, status, error } = useAppSelector((state) => state.chat)
  const [text, setText] = useState('')

  const isSending = status === 'sending'
  const isConfirming = status === 'confirming'

  // The docked bottom cluster (error banner + confirm card + form) is a
  // normal flex sibling of the scroll region, not an overlay, so it reserves
  // its own space and never covers the last message — no measuring needed
  // for layout. It's still watched here so a height change (confirm card
  // appearing, error banner showing) re-triggers the scroll-to-bottom below,
  // the same way a new message does.
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [bottomHeight, setBottomHeight] = useState(0)

  useLayoutEffect(() => {
    const node = bottomRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setBottomHeight(entry.contentRect.height))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // New messages (after send, after confirm) scroll the view to the bottom.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight })
  }, [messages, pending, bottomHeight])

  // Spec §5: the last 50 messages load once, on entering the page.
  useEffect(() => {
    dispatch(loadChatHistory())
  }, [dispatch])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const typed = text.trim()
    if (!typed || isSending) return
    dispatch(clearChatError())
    try {
      await dispatch(sendChatMessage(typed)).unwrap()
      setText('')
    } catch {
      // The message stays in the box — see the error banner below.
    }
  }

  const renderPending = (pending: PendingAction) => {
    switch (pending.intent) {
      case 'create-expense':
        return (
          <ol className="chat-drafts" aria-label="Expenses to add">
            {pending.drafts.map((draft, index) => (
              <li key={index}>
                {saneOrFallback(draft.store, undefined) ?? saneOrFallback(draft.description, undefined) ?? 'Expense'}{' '}
                — {saneOrFallback(draft.category, 'Category')} —{' '}
                <span className="figure">{money(draft.amount as number)}</span>
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
                  <button
                    type="button"
                    className="button button--plain"
                    onClick={() => dispatch(selectMatch(match._id))}
                  >
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
                  <button
                    type="button"
                    className="button button--plain"
                    onClick={() => dispatch(selectMatch(match._id))}
                  >
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

  const hasMessages = messages.length > 0

  return (
    <main className="chat-page">
      <h1>Chat</h1>

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

      {!hasMessages && <p className="chat-empty">Nothing here yet. Try “spent 50 at the supermarket.”</p>}

      <div className={`chat-bottom${hasMessages ? ' chat-bottom--docked' : ''}`} ref={bottomRef}>
        {error && (
          <div className="banner banner--error" role="alert">
            <AlertIcon />
            <span>{error}</span>
          </div>
        )}

        {pending && (
          <div className="card chat-confirm">
            {renderPending(pending)}
            <div className="chat-confirm__actions">
              {isReadyToConfirm(pending) && (
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => dispatch(confirmChatAction())}
                  disabled={isConfirming}
                >
                  {isConfirming ? 'Confirming…' : 'Confirm'}
                </button>
              )}
              <button type="button" className="button button--plain" onClick={() => dispatch(cancelPending())}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <form className="chat-form" onSubmit={handleSubmit}>
          <label htmlFor="chat-input" className="chat-form__label">
            Message
          </label>
          <input
            id="chat-input"
            className="input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={isSending}
            autoComplete="off"
            placeholder="Write it the way you would say it."
          />
          <button type="submit" className="button button--primary" disabled={isSending || !text.trim()}>
            {isSending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </div>
    </main>
  )
}
