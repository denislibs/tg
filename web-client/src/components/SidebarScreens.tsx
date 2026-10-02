import { lazy, Suspense } from 'react'

// Экран звонков — из меню, не первый кадр → лениво. Настроек здесь больше нет:
// корень — вкладка колоночного слайдера (`AppSettingsTab`, задача 28 плана 2D),
// её модуль грузится лениво сам (`solidJsTabs/tabs.ts`).
const CallsView = lazy(() => import('./CallsView'))

// Взаимоисключающие экраны левой колонки (в tweb в #column-left всегда один поверх
// списка чатов). null = список.
//
// Въезд справа играет CSS самого экрана — кейфрейм на вставке узла, как у tweb,
// где вкладки слайдера анимируются классами/кейфреймами, а не JS-движком
// (`tweb src/scss/partials/_slider.scss:226-241`). Поэтому обёрток-презенсов
// здесь больше нет: экран просто монтируется и размонтируется.
export type SidebarScreen =
  | 'calls' | null

interface SidebarScreensProps {
  screen: SidebarScreen
  /** снять текущий экран (null) */
  close: () => void
  onSelect: (id: string) => void
}

export default function SidebarScreens({
  screen,
  close,
  onSelect,
}: SidebarScreensProps) {
  return (
    <>
      <Suspense fallback={null}>
        {screen === 'calls' && (
          <CallsView onBack={close} onOpenChat={(chatId) => { close(); onSelect(String(chatId)) }} />
        )}
      </Suspense>
    </>
  )
}
