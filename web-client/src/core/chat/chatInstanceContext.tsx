import { createContext, useContext } from 'react'
import type { ChatInstanceDesc } from '../../stores/chatStackStore'

// В стеке одновременно смонтировано несколько инстансов чата (неактивные
// скрыты `display: none`, но живут в DOM — как вкладки tabs-container в tweb).
// Поэтому любой эффект инстанса, который вешает слушатель на window/document
// или пишет в глобальное состояние, обязан быть за `useIsActiveChat()`:
// иначе он сработает во всех копиях сразу.

export interface ChatInstanceValue {
  desc: ChatInstanceDesc
  isActive: boolean
}

const ChatInstanceContext = createContext<ChatInstanceValue | null>(null)

export const ChatInstanceProvider = ChatInstanceContext.Provider

export function useChatInstance(): ChatInstanceValue | null {
  return useContext(ChatInstanceContext)
}

/** Вне провайдера (старые точки монтирования, юнит-тесты) инстанс активен. */
export function useIsActiveChat(): boolean {
  return useContext(ChatInstanceContext)?.isActive ?? true
}
