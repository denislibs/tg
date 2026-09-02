/**
 * Регистрирует React-оверлей записью в очереди навигации
 * (`core/navigation/appNavigationController.ts`): пока `open` — в очереди лежит
 * запись и её запись истории, и браузерный/аппаратный Back, и Escape закрывают
 * именно её (`onClose`). Программное закрытие (× / клик по скриму) снимает
 * запись и «съедает» её запись истории.
 *
 * ── Хук закрывает ОБЕ кнопки, а не одну (#108) ─────────────────────────────
 * Раньше он вешал только слой Back (`navigationStack.pushLayer`), а Escape
 * каждый вызывающий регистрировал ОТДЕЛЬНО (`hotkeys.pushEsc`) — два стека,
 * два порядка, и расходились они при первом же закрытии не с той стороны. У
 * оригинала обе кнопки обслуживает один список записей, поэтому и здесь
 * запись одна.
 *
 * `onClose` держим в ref: иначе запись пересоздавалась бы на каждый рендер
 * родителя, а вместе с ней — пара `pushState`/`back` в истории.
 */
import { useEffect, useRef } from 'react'
import appNavigationController, { type NavigationItemType } from '@core/navigation/appNavigationController'

export function useNavLayer(open: boolean, onClose: () => void, type: NavigationItemType = 'popup'): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const item = appNavigationController.pushItem({
      type,
      onPop: () => onCloseRef.current(),
    })
    return () => appNavigationController.removeItem(item)
  }, [open, type])
}
