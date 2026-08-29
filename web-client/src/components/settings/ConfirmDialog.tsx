// ConfirmDialog — React-мост к портированному `confirmationPopup` (задача 3
// плана solid-wave-1; порт tweb `components/popups/simpleConfirmation.ts` +
// `peer.ts`, см. `components/popups/popupPeer.ts`). Раньше здесь была
// собственная JSX-вёрстка, дублировавшая ту же tweb-разметку, что уже строит
// портированный `PopupPeer`/`PopupElement` (`shared/ui/ConfirmPopup`, снесён
// этой же задачей) — теперь компонент только МОСТ: на монтировании открывает
// vanilla-попап и транслирует его исход (resolve/reject промиса) в пропы
// onConfirm/onClose, которые ждут 9 вызывающих (SearchView,
// DataStorageSettings, PrivacySecuritySettings, InviteLinkScreens,
// DiscussionScreen ×2, PinnedMessagesScreen, useChatPopups ×2, MediaEditor) —
// их контракт этой задачей не меняется.
//
// `title`/`text`/`action` приходят от вызывающих УЖЕ переведёнными строками
// (`t(...)` или интерполированным текстом, см. напр. DiscussionScreen.tsx —
// шаблонная строка с именем пира). `confirmationPopup` прогоняет
// `titleLangKey`/`descriptionLangKey` через СВОЙ `t()` ещё раз (peer.ts:58-59,
// :70) — для готовой строки это безопасно: наш `t()` — `dict[s] ?? s`
// (`@/i18n`), непереведённый/неизвестный ключ возвращается как есть.
//
// Владелец сам снимает то, что создал (правило шва, `web-client/CLAUDE.md`).
// Если ConfirmDialog размонтируют РАНЬШЕ исхода промиса (владелец-экран сам
// исчез — навигация в сторону, разлогин — не через СОБСТВЕННЫЙ `onClose`
// этого компонента), эффект снимает СВОЙ vanilla-попап явно (`forceHide()`
// через `getPopup`, наше расширение `confirmationPopup` — см. докблок
// `popupPeer.ts`), а не полагается на то, что React «унесёт» чужой DOM-узел
// вместе с собой — React о нём не знает, узел висит прямо на `document.body`.
import { useEffect, useRef } from 'react'
import { confirmationPopup } from '../popups/popupPeer'
import type PopupPeer from '../popups/popupPeer'

export default function ConfirmDialog({ title, text, action, danger, zIndex, onConfirm, onClose }: {
  title: string
  text: string
  action: string
  danger?: boolean
  /** поверх полноэкранных оверлеев (медиа-редактор и т.п.) — форвардится в
   *  `PopupOptions.zIndex` (наше расширение, см. докблок `popupElement.ts`) */
  zIndex?: number
  onConfirm: () => void
  onClose: () => void
}) {
  // Колбэки читаются в момент исхода промиса, а не на момент монтирования —
  // но сам попап обязан открыться РОВНО один раз за монтирование (владелец
  // монтирует/размонтирует компонент по месту действия, как и раньше).
  const cb = useRef({ onConfirm, onClose })
  cb.current = { onConfirm, onClose }

  useEffect(() => {
    let closed = false
    let popup: PopupPeer | undefined
    confirmationPopup({
      titleLangKey: title,
      descriptionLangKey: text,
      button: { text: action, isDanger: danger },
      zIndex,
      getPopup: (p) => { popup = p },
    }).then(
      () => cb.current.onConfirm(), // клик по кнопке действия
      () => {}, // отмена (Cancel/оверлей/Esc/Back) — onClose всё равно вызывается ниже
    ).finally(() => {
      if (!closed) cb.current.onClose()
    })
    return () => {
      closed = true
      popup?.forceHide() // владелец ушёл раньше исхода — снимаем СВОЙ узел сами
    }
    // Пустой массив зависимостей — намеренно: попап открывается РОВНО один раз
    // за монтирование компонента. Вызывающие монтируют ConfirmDialog заново на
    // каждый показ (условный рендер `{flag && <ConfirmDialog .../>}`), а не
    // держат его смонтированным между показами с меняющимися title/text —
    // повторный запуск эффекта по смене пропа открыл бы ВТОРОЙ попап поверх
    // первого, пока владелец ждёт исход первого.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
