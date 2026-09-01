import type { LangPackKey } from '@/lang'
import { lazy, Suspense } from 'react'
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
// списка чатов). null = список.
//
// Въезд справа играет CSS самого экрана — кейфрейм на вставке узла, как у tweb,
// где вкладки слайдера анимируются классами/кейфреймами, а не JS-движком
// (`tweb src/scss/partials/_slider.scss:226-241`). Поэтому обёрток-презенсов
// здесь больше нет: экран просто монтируется и размонтируется.
export type SidebarScreen =
  | 'settings' | 'contacts' | 'wallet' | 'calls'
  | 'newGroup' | 'newChannel' | 'newPrivate' | 'newSecret' | null

interface SidebarScreensProps {
  screen: SidebarScreen
  /** снять текущий экран (null) */
  close: () => void
  chats: Chat[]
  /** deep-open настроек на подэкран (контекстное меню «Настроить папки») */
  settingsSub: LangPackKey | null
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
        {screen === 'settings' && (
          <SettingsView onBack={onSettingsBack} onToggleMode={onToggleMode} chats={chats} initialSub={settingsSub ?? undefined} />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {screen === 'wallet' && <WalletView onBack={close} />}
      </Suspense>
      <Suspense fallback={null}>
        {screen === 'calls' && (
          <CallsView onBack={close} onOpenChat={(chatId) => { close(); onSelect(String(chatId)) }} />
        )}
      </Suspense>
      {screen === 'contacts' && (
        <ContactsView
          chats={chats}
          onSelect={(id) => { close(); onSelect(id) }}
          onBack={close}
          onOpenChat={(chatId) => { close(); onChatCreated?.(chatId) }}
        />
      )}
      {screen === 'newGroup' && (
        <NewGroupFlow onClose={close} onCreate={(name, memberIds, photo) => { onCreateGroup(name, memberIds, photo); close() }} />
      )}
      {screen === 'newChannel' && (
        <NewChannelFlow onClose={close} onCreate={(name, description) => { onCreateChannel(name, description); close() }} />
      )}
      {screen === 'newPrivate' && (
        <NewPrivateChat chats={chats} onClose={close} onSelect={onSelect} />
      )}
      {screen === 'newSecret' && (
        <NewPrivateChat chats={chats} title="SecretChat.New" excludeBots onClose={close} onSelect={(id) => onStartSecret(id)} />
      )}
    </>
  )
}
