// Экранов здесь больше нет: последний — «Звонки» — стал вкладкой `AppCallsTab`
// (задача 0а-4 волны 7). Файл сносит задача 0а-5 следующим коммитом.

// Взаимоисключающие экраны левой колонки (в tweb в #column-left всегда один поверх
// списка чатов). null = список.
//
// Въезд справа играет CSS самого экрана — кейфрейм на вставке узла, как у tweb,
// где вкладки слайдера анимируются классами/кейфреймами, а не JS-движком
// (`tweb src/scss/partials/_slider.scss:226-241`). Поэтому обёрток-презенсов
// здесь больше нет: экран просто монтируется и размонтируется.
export type SidebarScreen = null

interface SidebarScreensProps {
  screen: SidebarScreen
  /** снять текущий экран (null) */
  close: () => void
  onSelect: (id: string) => void
}

export default function SidebarScreens(_props: SidebarScreensProps) {
  return null
}
