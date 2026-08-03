import { lazy, Suspense } from 'react'
import { AnimatePresence } from 'framer-motion'
import ContactsView from './ContactsView'
import NewGroupFlow, { type GroupPhoto } from './NewGroupFlow'
import NewChannelFlow from './NewChannelFlow'
import NewPrivateChat from './NewPrivateChat'
import type { Chat } from '../data'

// Экран настроек со всеми под-экранами (Privacy/Notifications/Language/…) — большое
// поддерево JS+CSS, не нужное до первого кадра. Открывается из меню → грузим лениво.
const SettingsView = lazy(() => import('./SettingsView'))
// Кошелёк (звёзды) и экран звонков — тоже из меню, не первый кадр → лениво.
const WalletView = lazy(() => import('./stars/WalletView'))
const CallsView = lazy(() => import('./CallsView'))

// Взаимоисключающие экраны левой колонки (в tweb в #column-left всегда один поверх
// списка чатов). null = список. Suspense — СНАРУЖИ AnimatePresence: прямым потомком
// остаётся motion-компонент экрана, поэтому выезд/заезд панели сохраняются; Suspense
// срабатывает лишь на самой первой загрузке ленивого чанка.
export type SidebarScreen =
  | 'settings' | 'contacts' | 'wallet' | 'calls'
  | 'newGroup' | 'newChannel' | 'newPrivate' | 'newSecret' | null

interface SidebarScreensProps {
  screen: SidebarScreen
  /** снять текущий экран (null) */
  close: () => void
  chats: Chat[]
  /** deep-open настроек на подэкран (контекстное меню «Настроить папки») */
  settingsSub: string | null
  onSettingsBack: () => void
  onToggleMode: (coords?: { x: number; y: number }) => void
  onSelect: (id: string) => void
  onChatCreated?: (chatId: number) => void
  onCreateGroup: (name: string, memberIds: number[], photo: GroupPhoto | null) => void
  onCreateChannel: (name: string, description: string) => void
  onStartSecret: (id: string) => void
}

export default function SidebarScreens({
  screen,
  close,
  chats,
  settingsSub,
  onSettingsBack,
  onToggleMode,
  onSelect,
  onChatCreated,
  onCreateGroup,
  onCreateChannel,
  onStartSecret,
}: SidebarScreensProps) {
  return (
    <>
      <Suspense fallback={null}>
        <AnimatePresence>
          {screen === 'settings' && (
            <SettingsView onBack={onSettingsBack} onToggleMode={onToggleMode} chats={chats} initialSub={settingsSub ?? undefined} />
          )}
        </AnimatePresence>
      </Suspense>
      <Suspense fallback={null}>
        <AnimatePresence>
          {screen === 'wallet' && <WalletView onBack={close} />}
        </AnimatePresence>
      </Suspense>
      <Suspense fallback={null}>
        <AnimatePresence>
          {screen === 'calls' && (
            <CallsView onBack={close} onOpenChat={(chatId) => { close(); onSelect(String(chatId)) }} />
          )}
        </AnimatePresence>
      </Suspense>
      <AnimatePresence>
        {screen === 'contacts' && (
          <ContactsView
            chats={chats}
            onSelect={(id) => { close(); onSelect(id) }}
            onBack={close}
            onOpenChat={(chatId) => { close(); onChatCreated?.(chatId) }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {screen === 'newGroup' && (
          <NewGroupFlow onClose={close} onCreate={(name, memberIds, photo) => { onCreateGroup(name, memberIds, photo); close() }} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {screen === 'newChannel' && (
          <NewChannelFlow onClose={close} onCreate={(name, description) => { onCreateChannel(name, description); close() }} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {screen === 'newPrivate' && (
          <NewPrivateChat chats={chats} onClose={close} onSelect={onSelect} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {screen === 'newSecret' && (
          <NewPrivateChat chats={chats} title="New Secret Chat" excludeBots onClose={close} onSelect={(id) => onStartSecret(id)} />
        )}
      </AnimatePresence>
    </>
  )
}
