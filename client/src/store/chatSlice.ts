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

/**
 * Turns a `/chat/messages` result into what still needs confirming, or
 * `null` when there is nothing to confirm (no match, missing amount, an
 * intent the model didn't recognise).
 */
const buildPending = (result: ChatMessageResult): PendingAction | null => {
  switch (result.intent) {
    case 'create-expense': {
      const drafts = result.drafts ?? []
      // The model never invents an amount or a category — if one draft is
      // missing either, the reply already asks for it, so there is nothing
      // to confirm yet.
      if (drafts.length === 0 || drafts.some((draft) => draft.amount == null || draft.category == null))
        return null
      return { intent: 'create-expense', drafts }
    }
    case 'create-category':
      return result.draft ? { intent: 'create-category', draft: result.draft } : null
    case 'edit-expense':
    case 'delete-expense': {
      const matches = (result.matches ?? []) as ExpenseMatch[]
      if (matches.length === 0) return null
      const selectedId = matches.length === 1 ? matches[0]._id : null
      return result.intent === 'edit-expense'
        ? { intent: 'edit-expense', matches, changes: result.changes ?? {}, selectedId }
        : { intent: 'delete-expense', matches, selectedId }
    }
    case 'edit-category':
    case 'delete-category': {
      const matches = (result.matches ?? []) as CategoryMatch[]
      if (matches.length === 0) return null
      const selectedId = matches.length === 1 ? matches[0]._id : null
      return result.intent === 'edit-category'
        ? { intent: 'edit-category', matches, changes: result.changes ?? {}, selectedId }
        : { intent: 'delete-category', matches, selectedId }
    }
    case 'reset-categories':
      return { intent: 'reset-categories' }
    default:
      return null
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

      .addCase(sendChatMessage.pending, (state) => {
        state.status = 'sending'
        state.error = null
      })
      .addCase(sendChatMessage.fulfilled, (state, action) => {
        state.status = 'idle'
        state.messages.push({
          id: `u-${state.messages.length}`,
          role: 'user',
          text: action.meta.arg,
        })
        state.messages.push({
          id: `a-${state.messages.length}`,
          role: 'assistant',
          text: action.payload.reply,
        })
        state.pending = buildPending(action.payload)
      })
      .addCase(sendChatMessage.rejected, (state, action) => {
        state.status = 'idle'
        state.error = action.payload?.message ?? 'Something went wrong.'
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
