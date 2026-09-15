import { httpClient, toApiError } from './httpClient'
import type { ChatConfirmRequest, ChatConfirmResult, ChatHistoryMessage, ChatMessageResult } from './types'

/** Request one of the chat flow (spec §6): parse the text, nothing saved yet. */
export const sendMessage = async (text: string): Promise<ChatMessageResult> => {
  try {
    const { data } = await httpClient.post<ChatMessageResult>('/chat/messages', { text })
    return data
  } catch (error) {
    throw toApiError(error)
  }
}

/** Loads the chat history shown on entering `/home` (spec §5): the last
 *  `limit` messages, oldest first. */
export const getHistory = async (limit = 50): Promise<ChatHistoryMessage[]> => {
  try {
    const { data } = await httpClient.get<ChatHistoryMessage[]>('/chat/messages', { params: { limit } })
    return data
  } catch (error) {
    throw toApiError(error)
  }
}

/** Request two: only sent once the user explicitly confirms. */
export const confirmChat = async (payload: ChatConfirmRequest): Promise<ChatConfirmResult> => {
  try {
    const { data } = await httpClient.post<ChatConfirmResult>('/chat/confirm', payload)
    return data
  } catch (error) {
    throw toApiError(error)
  }
}
