// The AI chat — spec docs/specs/01-ai-chat.md §6-8. The only screen that
// changes anything: every intent goes through a parse (request one) and an
// explicit confirm (request two) before it touches the database.
import { useState, type FormEvent } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import {
  sendChatMessage,
  confirmChatAction,
  selectMatch,
  cancelPending,
  clearChatError,
  type PendingAction,
} from '../store/chatSlice'
import type { ExpenseMatch } from '../api/types'
import { AlertIcon } from './icons'

const money = (amount: number) => `₪${amount.toFixed(2)}`
const shortDate = (date: string) => date.slice(0, 10)

const describeExpense = (expense: ExpenseMatch) =>
  `${expense.store ?? expense.description ?? 'Expense'} — ${money(expense.amount)} — ${shortDate(expense.date)}`

const describeChanges = (changes: Record<string, unknown>) =>
  Object.entries(changes)
    .map(([field, value]) => `${field} to ${value}`)
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
                {draft.store ?? draft.description ?? 'Expense'} — {draft.category} —{' '}
                <span className="figure">{money(draft.amount as number)}</span>
              </li>
            ))}
          </ol>
        )

      case 'create-category':
        return (
          <p>
            {pending.draft.parent ? `${pending.draft.name}, under ${pending.draft.parent}` : pending.draft.name}
          </p>
        )

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
                    {match.name}
                  </button>
                </li>
              ))}
            </ol>
          )
        }
        const match = pending.matches.find((candidate) => candidate._id === pending.selectedId)!
        return pending.intent === 'edit-category' ? (
          <p>
            Rename "{match.name}" to "{pending.changes.name as string}"?
          </p>
        ) : (
          <p>Delete category "{match.name}"?</p>
        )
      }

      case 'reset-categories':
        return <p>Reset all your categories to the defaults? Expenses in removed categories move to "Other".</p>
    }
  }

  return (
    <main className="chat-page">
      <h1>Chat</h1>

      {error && (
        <div className="banner banner--error" role="alert">
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}

      {messages.length === 0 ? (
        <p className="chat-empty">Nothing here yet. Try “spent 50 at the supermarket.”</p>
      ) : (
        <ol className="chat-thread" aria-label="Conversation">
          {messages.map((message) => (
            <li key={message.id} className={`chat-bubble chat-bubble--${message.role}`}>
              {message.text}
            </li>
          ))}
        </ol>
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
    </main>
  )
}
