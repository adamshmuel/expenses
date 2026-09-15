import { describe, expect, it, vi, beforeEach } from 'vitest'
import { httpClient } from './httpClient'
import { sendMessage, confirmChat, getHistory } from './chatApi'

describe('chatApi request paths', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the typed text to /chat/messages', async () => {
    vi.spyOn(httpClient, 'post').mockResolvedValue({ data: { reply: 'ok', intent: 'unknown' } })
    await sendMessage('spent 50 at the supermarket')
    expect(httpClient.post).toHaveBeenCalledWith('/chat/messages', {
      text: 'spent 50 at the supermarket',
    })
  })

  it('sends a create-expense confirmation to /chat/confirm', async () => {
    vi.spyOn(httpClient, 'post').mockResolvedValue({ data: { changed: {} } })
    const drafts = [{ amount: 50, category: 'Groceries' }]
    await confirmChat({ intent: 'create-expense', drafts })
    expect(httpClient.post).toHaveBeenCalledWith('/chat/confirm', {
      intent: 'create-expense',
      drafts,
    })
  })

  it('sends an edit confirmation with id and changes', async () => {
    vi.spyOn(httpClient, 'post').mockResolvedValue({ data: { changed: {} } })
    await confirmChat({ intent: 'edit-expense', id: 'e1', changes: { amount: 200 } })
    expect(httpClient.post).toHaveBeenCalledWith('/chat/confirm', {
      intent: 'edit-expense',
      id: 'e1',
      changes: { amount: 200 },
    })
  })

  it('loads the last 50 messages, oldest first', async () => {
    const history = [
      { _id: 'm1', text: 'hi', role: 'user', author: 'u1', createdAt: '2026-09-01', updatedAt: '2026-09-01' },
    ]
    vi.spyOn(httpClient, 'get').mockResolvedValue({ data: history })
    const result = await getHistory()
    expect(httpClient.get).toHaveBeenCalledWith('/chat/messages', { params: { limit: 50 } })
    expect(result).toEqual(history)
  })

  it('turns a failed request into an ApiError', async () => {
    vi.spyOn(httpClient, 'post').mockRejectedValue({ isAxiosError: false })
    await expect(sendMessage('x')).rejects.toEqual({
      message: 'Something went wrong.',
      fieldErrors: {},
    })
  })
})
