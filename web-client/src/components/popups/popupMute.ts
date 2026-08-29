// Порт tweb `components/popups/mute.ts` (класс `PopupMute extends PopupPeer`,
// 52 строки, целиком): аватар чата (32, `PopupPeer.peerId`, mute.ts:32) +
// заголовок «Notifications» (mute.ts:33) + радио-список длительностей
// заглушения в `body` (mute.ts:38-48, `body: true`) + кнопка MUTE (auto-Cancel
// от `PopupPeer`, mute.ts:34-37).
//
// Расхождения с оригиналом, каждое обосновано по месту:
//  • Радио-список — «наша реализация» (`TgIcon radioon/radiooff` +
//    `role="radio"`/`aria-checked`), а НЕ порт tweb `RadioFormFromValues`/
//    `RadioField` (`components/row.ts`/`components/radioField.ts`). Это
//    решение принято ДО этой волны — в снесённой этим портом React-версии
//    (`components/MutePopup.tsx`, комментарий там же: «Радио — наша
//    реализация»), здесь оно лишь переведено в vanilla DOM, а не выдумано
//    заново. Полный порт generic `Row`/`RadioField` — самостоятельная задача:
//    в объёме волны 1 других потребителей generic `Row` нет.
//  • Без ripple на строках — тот же вычет, что уже сделан в
//    `popupElement.ts::setButtons` (кнопки попапа) и `checkboxField.ts`:
//    `components/ripple.ts` в репозитории ещё нет.
//  • `threadId` (mute.ts:30, :34, :44) и прямой вызов
//    `managers.appMessagesManager.mutePeer` (mute.ts:35-36) не портированы:
//    наш менеджерный API мьюта отличается от tweb (мьютит вызывающий экрана,
//    `useChatPopups.tsx` → `d.applyMute`), поэтому конструктор принимает
//    готовый колбэк `onMute` — то же расхождение уже было в React-версии.
import Icon, { getIconContent } from '@components/icon'
import PopupPeer from './popupPeer'
import type { AvatarManagers } from '@components/avatar'
import { useI18nStore } from '@/i18n'
import s from '../MutePopup.module.scss'

const ONE_HOUR = 3600 // mute.ts:6

// mute.ts:7-27, дословно (langPackKey → уже переведённый label — наш `t()`
// не различает эти два понятия, см. докблок `popupPeer.ts`).
const TIMES: { value: number, label: string }[] = [
  { value: ONE_HOUR, label: 'For 1 Hour' },
  { value: ONE_HOUR * 4, label: 'For 4 Hours' },
  { value: ONE_HOUR * 8, label: 'For 8 Hours' },
  { value: ONE_HOUR * 24, label: 'For 1 Day' },
  { value: ONE_HOUR * 24 * 3, label: 'For 3 Days' },
  { value: -1, label: 'Forever' }, // mute.ts:24-27, отмечен по умолчанию
]

export default class PopupMute extends PopupPeer {
  constructor(peerId: PeerId, managers: AvatarManagers, onMute: (seconds: number | null) => void) {
    const t = useI18nStore.getState().t

    super('popup-mute', { // mute.ts:30
      peerId, // mute.ts:32
      managers,
      titleLangKey: 'Notifications', // mute.ts:33
      buttons: [{ // mute.ts:34-37
        text: t('Mute'),
        callback: () => onMute(selected === -1 ? null : selected),
      }],
      body: true, // mute.ts:38
    })

    let selected = -1 // mute.ts:26 — «Forever» отмечен изначально

    const list = document.createElement('div')
    list.className = s.list
    list.setAttribute('role', 'radiogroup')

    const rows = TIMES.map((tm) => {
      const row = document.createElement('div')
      row.className = s.row
      row.setAttribute('role', 'radio')

      const icon = Icon('radiooff')
      const text = document.createElement('span')
      text.style.fontSize = '1rem' // Text size={16} — снесённая React-версия
      text.textContent = t(tm.label)
      row.append(icon, text)

      row.addEventListener('click', () => {
        selected = tm.value
        paint()
      })

      list.append(row)
      return { row, icon, text, value: tm.value }
    })

    // Перекраска активной строки — единственное, что меняется по клику
    // (mute.ts не рендерит заново, RadioField сам переключает свой чекнутый
    // узел; здесь тот же эффект даёт полный проход по строкам).
    const paint = () => {
      for(const r of rows) {
        const checked = r.value === selected
        r.row.setAttribute('aria-checked', String(checked))
        r.icon.textContent = getIconContent(checked ? 'radioon' : 'radiooff')
        r.text.style.color = checked ? 'var(--primary-color)' : 'var(--primary-text-color)'
      }
    }
    paint()

    this.body!.append(list) // mute.ts:47, `this.body.append(radioForm)`

    this.show() // mute.ts:51
  }
}
