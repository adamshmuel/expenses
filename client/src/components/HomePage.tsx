// The AI chat — spec docs/specs/01-ai-chat.md §6-8. The only screen that
// changes anything: every intent goes through a parse (request one) and an
// explicit confirm (request two) before it touches the database.
//
// The actual message thread, confirm card and composer live in ChatScreen —
// a presentational component with no Redux and no network of its own, so the
// "How to use" tutorial can replay a scripted conversation through the exact
// same markup (docs/specs/12-how-to-use.md §4).
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import {
  loadChatHistory,
  sendChatMessage,
  confirmChatAction,
  selectMatch,
  cancelPending,
  clearChatError,
} from '../store/chatSlice'
import { ChatScreen } from './ChatScreen'

// The first thing a brand-new account sees here — spec §7 "No messages yet".
// The invitation says what to type; the line below it is a concrete example,
// so a first-time user isn't staring at a blank composer guessing the format.
const EMPTY_STATE_INVITE = "Type an expense the way you'd say it out loud."
const EMPTY_STATE_HINT = 'Try “spent 50 at the supermarket,” or “add a category called Subscriptions.”'

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
    // Cleared right away, in the same tick as the dispatch below — that's
    // what pushes the bubble into the transcript (chatSlice's
    // sendChatMessage.pending). The text is never in both places at once.
    setText('')
    try {
      await dispatch(sendChatMessage(typed)).unwrap()
    } catch {
      // The send failed and chatSlice already popped the optimistic bubble
      // back off the transcript — put the text back so the user can retry.
      setText(typed)
    }
  }

  return (
    <main className="chat-page">
      <h1>Chat</h1>
      {/* Wrapped separately from the h1 so the empty state's centering
          (.chat-body:has(.chat-empty), index.css) only pulls the invitation
          and composer to the middle of the remaining space — the "Chat"
          heading stays pinned at the top either way. */}
      <div className="chat-body">
        <ChatScreen
          messages={messages}
          pending={pending}
          error={error}
          isSending={isSending}
          isConfirming={isConfirming}
          inputValue={text}
          onInputChange={setText}
          onSubmit={handleSubmit}
          onSelectMatch={(id) => dispatch(selectMatch(id))}
          onConfirm={() => dispatch(confirmChatAction())}
          onCancel={() => dispatch(cancelPending())}
          scrollRef={scrollRef}
          bottomRef={bottomRef}
          emptyStateInvite={EMPTY_STATE_INVITE}
          emptyStateHint={EMPTY_STATE_HINT}
        />
      </div>
    </main>
  )
}
