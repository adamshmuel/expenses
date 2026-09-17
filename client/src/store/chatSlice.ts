import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import * as chatApi from '../api/chatApi'
import type {
  ApiError,
  CategoryMatch,
  ChatConfirmRequest,
  ChatHistoryMessage,
  ChatMessageResult,
  DraftCategory,
  DraftExpense,
  ExpenseMatch,
} from '../api/types'

export interface ChatMessageItem {
  id: string
  role: 'user' | 'assistant'
  text: string
}

/** What is waiting on the user's confirm/cancel, built from the last
 *  `/chat/messages` reply (spec §6). Nothing here has been saved. */
export type PendingAction =
  | { intent: 'create-expense'; drafts: DraftExpense[] }
  | { intent: 'create-category'; draft: DraftCategory }
  | { intent: 'edit-expense'; matches: ExpenseMatch[]; changes: Record<string, unknown>; selectedId: string | null }
  | { intent: 'delete-expense'; matches: ExpenseMatch[]; selectedId: string | null }
  | { intent: 'edit-category'; matches: CategoryMatch[]; changes: Record<string, unknown>; selectedId: string | null }
  | { intent: 'delete-category'; matches: CategoryMatch[]; selectedId: string | null }
  | { intent: 'reset-categories' }

interface ChatState {
  messages: ChatMessageItem[]
  pending: PendingAction | null
  status: 'idle' | 'sending' | 'confirming'
  error: string | null
}

const initialState: ChatState = {
  messages: [],
  pending: null,
  status: 'idle',
  error: null,
}

// A store/description name a person actually typed is short. Anything past
// this is treated as a glitch, not a long store name.
const MAX_FREE_TEXT_LENGTH = 200

// Patterns typical of a leaked JSON or HTML fragment reaching a free-text
// field (bug 2): an HTML tag or closing tag, or a serialized-JSON-looking
// `", "key":` run. Plain punctuation a real name can contain — apostrophes,
// ampersands, emoji, non-Latin scripts — never matches these.
const HTML_FRAGMENT_PATTERN = /<\/|<html|<body/i
const JSON_FRAGMENT_PATTERN = /"\s*,\s*"[^"]+"\s*:|[{}]/

/**
 * True when a free-text field coming from the AI (a store or description
 * name) looks like natural text rather than a raw JSON/HTML fragment leaked
 * by a model glitch. `undefined`/`null`/empty are fine — that's just a field
 * the model left out, not a malformed one.
 */
export const isSaneText = (value: string | null | undefined): boolean => {
  if (!value) return true
  if (value.length > MAX_FREE_TEXT_LENGTH) return false
  if (HTML_FRAGMENT_PATTERN.test(value)) return false
  if (JSON_FRAGMENT_PATTERN.test(value)) return false
  return true
}

/** What the user reads when a draft is dropped because the model glitched —
 *  never for a "how much was it?"/"no match" case, those are already said in
 *  `reply` and this would just add noise on top of a working flow. */
const UNREADABLE_DRAFT_MESSAGE = "That didn't come out right — I couldn't read part of the reply. Try rephrasing."

/**
 * `buildPending`'s result: either something to confirm, nothing to confirm
 * because that's the normal shape of this reply (missing amount, no match,
 * unrecognised text — `reply` already covers these), or nothing to confirm
 * because the model produced a broken draft (a free-text field that looks
 * like leaked JSON/HTML, or a required field missing outright) — this last
 * case is the only one that also carries a message for the user.
 */
const buildPending = (result: ChatMessageResult): { pending: PendingAction | null; error: string | null } => {
  switch (result.intent) {
    case 'create-expense': {
      const drafts = result.drafts ?? []
      if (drafts.length === 0) return { pending: null, error: null }
      // The model never invents an amount or a category — if one draft is
      // missing either, the reply already asks for it, so there is nothing
      // to confirm yet, and nothing wrong to report.
      if (drafts.some((draft) => draft.amount == null || draft.category == null))
        return { pending: null, error: null }
      // Amount and category are both present, so this draft was meant to be
      // ready to confirm — a free-text field that fails isSaneText here
      // means the model glitched, not that it's waiting on the user.
      if (drafts.some((draft) => !isSaneText(draft.store) || !isSaneText(draft.description)))
        return { pending: null, error: UNREADABLE_DRAFT_MESSAGE }
      return { pending: { intent: 'create-expense', drafts }, error: null }
    }
    case 'create-category':
      // Unlike a missing amount, there's no "ask for the name" sub-flow for
      // a category — the model claimed this intent but sent nothing to act
      // on, which is the same kind of glitch as an unreadable field.
      return result.draft
        ? { pending: { intent: 'create-category', draft: result.draft }, error: null }
        : { pending: null, error: UNREADABLE_DRAFT_MESSAGE }
    case 'edit-expense':
    case 'delete-expense': {
      const matches = (result.matches ?? []) as ExpenseMatch[]
      // No match is a normal outcome the reply already states ("no expense
      // matches that") — nothing broke, there's just nothing to act on.
      if (matches.length === 0) return { pending: null, error: null }
      const selectedId = matches.length === 1 ? matches[0]._id : null
      return {
        pending:
          result.intent === 'edit-expense'
            ? { intent: 'edit-expense', matches, changes: result.changes ?? {}, selectedId }
            : { intent: 'delete-expense', matches, selectedId },
        error: null,
      }
    }
    case 'edit-category':
    case 'delete-category': {
      const matches = (result.matches ?? []) as CategoryMatch[]
      if (matches.length === 0) return { pending: null, error: null }
      const selectedId = matches.length === 1 ? matches[0]._id : null
      return {
        pending:
          result.intent === 'edit-category'
            ? { intent: 'edit-category', matches, changes: result.changes ?? {}, selectedId }
            : { intent: 'delete-category', matches, selectedId },
        error: null,
      }
    }
    case 'reset-categories':
      return { pending: { intent: 'reset-categories' }, error: null }
    default:
      // An intent the model didn't recognise — the reply already says so
      // (spec §7 "text does not match any of the seven intents").
      return { pending: null, error: null }
  }
}

const toConfirmRequest = (pending: PendingAction): ChatConfirmRequest => {
  switch (pending.intent) {
    case 'create-expense':
      return { intent: 'create-expense', drafts: pending.drafts }
    case 'create-category':
      return { intent: 'create-category', draft: pending.draft }
    case 'edit-expense':
      return { intent: 'edit-expense', id: pending.selectedId as string, changes: pending.changes }
    case 'edit-category':
      return { intent: 'edit-category', id: pending.selectedId as string, changes: pending.changes }
    case 'delete-expense':
      return { intent: 'delete-expense', id: pending.selectedId as string }
    case 'delete-category':
      return { intent: 'delete-category', id: pending.selectedId as string }
    case 'reset-categories':
      return { intent: 'reset-categories' }
  }
}

// Loaded once on entering /home (spec §5): the last 50 messages, oldest first.
export const loadChatHistory = createAsyncThunk<ChatHistoryMessage[], void, { rejectValue: ApiError }>(
  'chat/loadHistory',
  async (_, { rejectWithValue }) => {
    try {
      return await chatApi.getHistory()
    } catch (error) {
      return rejectWithValue(error as ApiError)
    }
  },
)

// Request one (spec §6): parses the text. What comes back may or may not be
// something the user can confirm — see buildPending.
export const sendChatMessage = createAsyncThunk<ChatMessageResult, string, { rejectValue: ApiError }>(
  'chat/sendMessage',
  async (text, { rejectWithValue }) => {
    try {
      return await chatApi.sendMessage(text)
    } catch (error) {
      return rejectWithValue(error as ApiError)
    }
  },
)

// Request two: only reachable once the user has clicked Confirm, so `pending`
// is always set when this runs — see the "Confirm" button in HomePage.
export const confirmChatAction = createAsyncThunk<
  void,
  void,
  { state: { chat: ChatState }; rejectValue: ApiError }
>('chat/confirm', async (_, { getState, rejectWithValue }) => {
  const { pending } = getState().chat
  if (!pending) return
  try {
    await chatApi.confirmChat(toConfirmRequest(pending))
  } catch (error) {
    return rejectWithValue(error as ApiError)
  }
})

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    /** The user picked one of several matches (spec §6 "several matches"). */
    selectMatch(state, action: PayloadAction<string>) {
      if (state.pending && 'matches' in state.pending) {
        state.pending.selectedId = action.payload
      }
    },
    /** The user cancelled — nothing changes, spec §6. */
    cancelPending(state) {
      state.pending = null
    },
    clearChatError(state) {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadChatHistory.fulfilled, (state, action) => {
        state.messages = action.payload.map((message) => ({
          id: message._id,
          role: message.role,
          text: message.text,
        }))
      })
      .addCase(loadChatHistory.rejected, (state, action) => {
        state.error = action.payload?.message ?? 'Something went wrong.'
      })

      .addCase(sendChatMessage.pending, (state, action) => {
        state.status = 'sending'
        state.error = null
        // Shown right away — it's the user's own text, already known
        // locally, with nothing to wait on the server for (bug: it used to
        // appear only once the reply came back, ~3s later).
        state.messages.push({
          id: `u-${state.messages.length}`,
          role: 'user',
          text: action.meta.arg,
        })
      })
      .addCase(sendChatMessage.fulfilled, (state, action) => {
        state.status = 'idle'
        state.messages.push({
          id: `a-${state.messages.length}`,
          role: 'assistant',
          text: action.payload.reply,
        })
        const { pending, error } = buildPending(action.payload)
        state.pending = pending
        if (error) state.error = error
      })
      .addCase(sendChatMessage.rejected, (state, action) => {
        state.status = 'idle'
        state.error = action.payload?.message ?? 'Something went wrong.'
        // Undo the optimistic push above: the request never actually went
        // through, so the transcript should not claim it did. The composer
        // still holds the text (HomePage doesn't clear it on failure), so
        // the user can just retry.
        state.messages.pop()
      })

      .addCase(confirmChatAction.pending, (state) => {
        state.status = 'confirming'
        state.error = null
      })
      .addCase(confirmChatAction.fulfilled, (state) => {
        state.status = 'idle'
        state.pending = null
        state.messages.push({ id: `a-${state.messages.length}`, role: 'assistant', text: 'Done.' })
      })
      .addCase(confirmChatAction.rejected, (state, action) => {
        state.status = 'idle'
        state.error = action.payload?.message ?? 'Something went wrong.'
      })
  },
})

export const { selectMatch, cancelPending, clearChatError } = chatSlice.actions
export default chatSlice.reducer
