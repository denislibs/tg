/**
 * Побочки настройки «Энергосбережение» — порт части tweb
 * `appImManager.setSettings` (`lib/appImManager.ts:2738-2757`, 812502980),
 * которую оригинал зовёт на каждое `settings_updated`:
 *  • `body.animation-level-0/1/2` по `liteMode.isAvailable('animations')` —
 *    гейт портированных `@include animation-level(2)`;
 *  • `html.no-backdrop` по `liteMode.isAvailable('blur')` (у Firefox — всегда);
 *  • автоплей стикеров по ключам `stickers_chat`/`stickers_panel` и их зацикливание
 *    (`appSettings.stickers.loop` → наш `loopStickers`) в `animationIntersector`.
 *
 * Подписчик самой настройки, а не обработчик строки вкладки: срабатывает, кто бы
 * ни поменял `liteMode` — вкладка, пункт меню «Ещё», соседняя вкладка браузера
 * (`storage`-слушатель `settings.tsx`). Раньше то же делали два React-эффекта
 * `App.tsx` по прежнему флагу «Без анимаций»; заводит подписку он же, до пейнта.
 *
 * Расхождение: оригинал пересчитывает всё на любое `settings_updated`; здесь —
 * только на смену `liteMode`/`loopStickers` (прочие ветки `setSettings` — размер
 * текста, формат времени — у нас живут у своих настроек).
 */
import { IS_FIREFOX } from '@environment/userAgent'
import liteMode, { type LiteModeKey } from '@helpers/liteMode'
import animationIntersector from '@components/animationIntersector'
import { useSettingsStore, type Settings } from '@/settings'

function applyLiteModeSettings(settings: Settings) {
  // tweb :2738-2740
  document.body.classList.toggle('animation-level-0', !liteMode.isAvailable('animations'))
  document.body.classList.toggle('animation-level-1', false)
  document.body.classList.toggle('animation-level-2', liteMode.isAvailable('animations'))

  // tweb :2742-2743 — Firefox держит no-backdrop всегда: backdrop-filter у него плохой
  document.documentElement.classList.toggle('no-backdrop', !liteMode.isAvailable('blur') || IS_FIREFOX)

  // tweb :2752-2757
  const c: LiteModeKey[] = ['stickers_chat', 'stickers_panel']
  const changedLoop = animationIntersector.setLoop(settings.loopStickers)
  const changedAutoplay = !!c.filter((key) => animationIntersector.setAutoplay(liteMode.isAvailable(key), key)).length
  if(changedLoop || changedAutoplay) {
    animationIntersector.checkAnimations2(false)
  }
}

/** Применить текущее значение и следить за сменой. Возвращает отписку. */
export function watchLiteModeSettings(): () => void {
  applyLiteModeSettings(useSettingsStore.getState())
  return useSettingsStore.subscribe((state, prev) => {
    if(state.liteMode !== prev.liteMode || state.loopStickers !== prev.loopStickers) {
      applyLiteModeSettings(state)
    }
  })
}
