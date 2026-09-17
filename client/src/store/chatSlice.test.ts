import { describe, expect, it, vi, beforeEach } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import chatReducer, {
  sendChatMessage,
  confirmChatAction,
  loadChatHistory,
  selectMatch,
  cancelPending,
  isSaneText,
} from './chatSlice'
import * as chatApi from '../api/chatApi'

vi.mock('../api/chatApi')

const makeStore = () => configureStore({ reducer: { chat: chatReducer } })

describe('chatSlice', () => {
  beforeEach(() => vi.resetAllMocks())

  it('starts with no messages and nothing pending', () => {
    const { chat } = makeStore().getState()
    expect(chat.messages).toEqual([])
    expect(chat.pending).toBeNull()
  })

  it('loads history into messages, oldest first', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue([
      { _id: 'm1', text: 'spent 50 at the supermarket', role: 'user', author: 'u1', createdAt: 'x', updatedAt: 'x' },
      { _id: 'm2', text: 'Added.', role: 'assistant', author: 'u1', createdAt: 'x', updatedAt: 'x' },
    ])
    const store = makeStore()
    await store.dispatch(loadChatHistory())
    expect(store.getState().chat.messages).toEqual([
      { id: 'm1', role: 'user', text: 'spent 50 at the supermarket' },
      { id: 'm2', role: 'assistant', text: 'Added.' },
    ])
  })

  it('leaves messages empty when there is no history', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue([])
    const store = makeStore()
    await store.dispatch(loadChatHistory())
    expect(store.getState().chat.messages).toEqual([])
  })

  it('appends the user text and the assistant reply after a plain reply', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({ reply: 'Not sure what you mean.', intent: 'unknown' })
    const store = makeStore()
    await store.dispatch(sendChatMessage('asdkjh'))
    const { messages, pending } = store.getState().chat
    expect(messages.map((m) => m.text)).toEqual(['asdkjh', 'Not sure what you mean.'])
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
    expect(pending).toBeNull()
  })

  it('holds a create-expense draft as pending when the amount is present', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Add this?',
      intent: 'create-expense',
      drafts: [{ amount: 50, store: 'Supermarket', category: 'Groceries', date: '2026-09-15' }],
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('spent 50 at the supermarket'))
    expect(store.getState().chat.pending).toEqual({
      intent: 'create-expense',
      drafts: [{ amount: 50, store: 'Supermarket', category: 'Groceries', date: '2026-09-15' }],
    })
  })

  it('has nothing pending when a draft is missing its amount', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'How much did you spend?',
      intent: 'create-expense',
      drafts: [{ store: 'Supermarket', category: 'Groceries' }],
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('spent something at the supermarket'))
    expect(store.getState().chat.pending).toBeNull()
  })

  it('has nothing pending when a draft is missing its category', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'I see you spent 50, but what was this for?',
      intent: 'create-expense',
      drafts: [{ amount: 50 }],
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('paid 50'))
    expect(store.getState().chat.pending).toBeNull()
  })

  it('has nothing pending when an edit matches no expense', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'No expense matches that.',
      intent: 'edit-expense',
      matches: [],
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('change the coffee expense to 20'))
    expect(store.getState().chat.pending).toBeNull()
  })

  it('auto-selects the only match when an edit finds exactly one expense', async () => {
    const match = { _id: 'e1', amount: 12, store: 'Cafe', date: '2026-09-14' }
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Change it to 20?',
      intent: 'edit-expense',
      matches: [match],
      changes: { amount: 20 },
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('change the coffee to 20'))
    const { pending } = store.getState().chat
    expect(pending).toMatchObject({ intent: 'edit-expense', selectedId: 'e1' })
  })

  it('waits for a pick when an edit matches several expenses', async () => {
    const matches = [
      { _id: 'e1', amount: 12, store: 'Cafe', date: '2026-09-14' },
      { _id: 'e2', amount: 8, store: 'Cafe', date: '2026-09-10' },
    ]
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Which one?',
      intent: 'edit-expense',
      matches,
      changes: { amount: 20 },
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('change the coffee to 20'))
    expect(store.getState().chat.pending).toMatchObject({ intent: 'edit-expense', selectedId: null })

    store.dispatch(selectMatch('e2'))
    expect(store.getState().chat.pending).toMatchObject({ selectedId: 'e2' })
  })

  it('keeps reset-categories pending so it can be confirmed', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'This resets every category. Continue?',
      intent: 'reset-categories',
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('reset my categories'))
    expect(store.getState().chat.pending).toEqual({ intent: 'reset-categories' })
  })

  it('records a plain error and keeps the pending action untouched on network failure', async () => {
    vi.mocked(chatApi.sendMessage).mockRejectedValue({
      message: 'Cannot reach the server. Check that it is running.',
      fieldErrors: {},
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('spent 50 at the supermarket'))
    expect(store.getState().chat.error).toBe('Cannot reach the server. Check that it is running.')
    expect(store.getState().chat.messages).toEqual([])
  })

  it('clears pending and confirms create-expense with all drafts', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Add this?',
      intent: 'create-expense',
      drafts: [{ amount: 50, category: 'Groceries' }],
    })
    vi.mocked(chatApi.confirmChat).mockResolvedValue({ changed: {} })
    const store = makeStore()
    await store.dispatch(sendChatMessage('spent 50 on groceries'))
    await store.dispatch(confirmChatAction())

    expect(chatApi.confirmChat).toHaveBeenCalledWith({
      intent: 'create-expense',
      drafts: [{ amount: 50, category: 'Groceries' }],
    })
    expect(store.getState().chat.pending).toBeNull()
  })

  it('confirms an edit with the selected id and the parsed changes', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Change it to 20?',
      intent: 'edit-expense',
      matches: [{ _id: 'e1', amount: 12, store: 'Cafe', date: '2026-09-14' }],
      changes: { amount: 20 },
    })
    vi.mocked(chatApi.confirmChat).mockResolvedValue({ changed: {} })
    const store = makeStore()
    await store.dispatch(sendChatMessage('change the coffee to 20'))
    await store.dispatch(confirmChatAction())

    expect(chatApi.confirmChat).toHaveBeenCalledWith({
      intent: 'edit-expense',
      id: 'e1',
      changes: { amount: 20 },
    })
  })

  it('cancels the pending action without calling confirm', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Add this?',
      intent: 'create-expense',
      drafts: [{ amount: 50, category: 'Groceries' }],
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('spent 50 on groceries'))
    store.dispatch(cancelPending())
    expect(store.getState().chat.pending).toBeNull()
    expect(chatApi.confirmChat).not.toHaveBeenCalled()
  })

  it('has nothing pending when a draft store field contains a leaked HTML fragment', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Add this?',
      intent: 'create-expense',
      drafts: [
        {
          amount: 50,
          category: 'Groceries',
          store: 'supermarket", "category": "Groceries", "date": "2023-10-24" } ] }</body></html>',
        },
      ],
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('spent 50 at the supermarket'))
    expect(store.getState().chat.pending).toBeNull()
  })

  it('has nothing pending when a draft description is absurdly long', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Add this?',
      intent: 'create-expense',
      drafts: [{ amount: 50, category: 'Groceries', description: 'a'.repeat(300) }],
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('spent 50 on something'))
    expect(store.getState().chat.pending).toBeNull()
  })

  it('sets an error and drops the draft when a complete create-expense draft has an unreadable store field', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Want me to add this?',
      intent: 'create-expense',
      drafts: [
        {
          amount: 50,
          category: 'Groceries',
          store: 'supermarket", "category": "Groceries", "date": "2023-10-24" } ] }</body></html>',
        },
      ],
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('spent 50 somewhere'))
    const { pending, error } = store.getState().chat
    expect(pending).toBeNull()
    expect(error).toMatch(/couldn.t read that reply|try rephrasing/i)
  })

  it('does not set an error when create-expense is only waiting on a missing amount', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'How much did you spend?',
      intent: 'create-expense',
      drafts: [{ store: 'Supermarket', category: 'Groceries' }],
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('spent something at the supermarket'))
    expect(store.getState().chat.pending).toBeNull()
    expect(store.getState().chat.error).toBeNull()
  })

  it('does not set an error when an edit matches no expense', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'No expense matches that.',
      intent: 'edit-expense',
      matches: [],
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('change the coffee expense to 20'))
    expect(store.getState().chat.pending).toBeNull()
    expect(store.getState().chat.error).toBeNull()
  })

  it('does not set an error for an unrecognised intent', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({ reply: 'Not sure what you mean.', intent: 'unknown' })
    const store = makeStore()
    await store.dispatch(sendChatMessage('asdkjh'))
    expect(store.getState().chat.pending).toBeNull()
    expect(store.getState().chat.error).toBeNull()
  })

  it('sets an error when a create-category intent comes back with no draft', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Add this category?',
      intent: 'create-category',
    })
    const store = makeStore()
    await store.dispatch(sendChatMessage('add a category called Pets'))
    const { pending, error } = store.getState().chat
    expect(pending).toBeNull()
    expect(error).toMatch(/couldn.t read that reply|try rephrasing/i)
  })

  it('keeps a draft pending when the store name has an apostrophe, ampersand, emoji or Hebrew text', async () => {
    const cases = ["Carrefour l'Étoile", 'Möbelhaus & Co.', 'סופר יוסי', '🍕 Pizza place']
    for (const store of cases) {
      vi.mocked(chatApi.sendMessage).mockResolvedValue({
        reply: 'Add this?',
        intent: 'create-expense',
        drafts: [{ amount: 50, category: 'Groceries', store }],
      })
      const testStore = makeStore()
      await testStore.dispatch(sendChatMessage('spent 50'))
      expect(testStore.getState().chat.pending).toEqual({
        intent: 'create-expense',
        drafts: [{ amount: 50, category: 'Groceries', store }],
      })
    }
  })
})

describe('isSaneText', () => {
  it('rejects a literal HTML tag', () => {
    expect(isSaneText('<html><body>hi</body></html>')).toBe(false)
  })

  it('rejects a closing-tag fragment', () => {
    expect(isSaneText('supermarket</body></html>')).toBe(false)
  })

  it('rejects a leaked JSON punctuation pattern', () => {
    expect(isSaneText('supermarket", "category": "Groceries" }')).toBe(false)
  })

  it('rejects a string longer than 200 characters', () => {
    expect(isSaneText('a'.repeat(201))).toBe(false)
  })

  it('accepts a store name with an apostrophe', () => {
    expect(isSaneText("Carrefour l'Étoile")).toBe(true)
  })

  it('accepts a store name with an ampersand', () => {
    expect(isSaneText('Möbelhaus & Co.')).toBe(true)
  })

  it('accepts a Hebrew store name', () => {
    expect(isSaneText('סופר יוסי')).toBe(true)
  })

  it('accepts a description starting with an emoji', () => {
    expect(isSaneText('🍕 Pizza place')).toBe(true)
  })

  it('accepts an ordinary short description', () => {
    expect(isSaneText('Weekly groceries')).toBe(true)
  })

  it('accepts an empty or missing value', () => {
    expect(isSaneText(undefined)).toBe(true)
    expect(isSaneText(null)).toBe(true)
    expect(isSaneText('')).toBe(true)
  })
})
