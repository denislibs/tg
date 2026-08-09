// Порт tweb `src/components/sidebarLeft/pendingSuggestionController.ts`.
//
// Отступления от tweb:
//   • `available` у него — реактивный геттер Solid'а (`() => boolean`); у нас
//     значение считает хук-конструктор на рендере, поэтому это просто флаг;
//   • `component` принимает `collapsed` пропом — в Solid'е свёрнутость читается
//     из глобального сигнала `useIsSidebarCollapsed`, у нас её знает Sidebar.
import type { ComponentType } from 'react'

export interface PendingSuggestionProps {
  /** сайдбар свёрнут в узкую полосу (tweb useIsSidebarCollapsed) */
  collapsed?: boolean
}

export interface PendingSuggestionController {
  available: boolean
  component: ComponentType<PendingSuggestionProps>
}
