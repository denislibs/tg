// Порт tweb `src/components/chat/utils.ts` (812502980) — в объёме Б-37: `slowModeTimer`
// (`:122-133`). Остальные функции модуля (`generateTail` — у нас `chat/tail.ts`,
// `makeTime`, проверки бота кодов и гостевых сообщений, тип вложения правки) сюда
// заезжают вместе со своими потребителями.
//
// РАСХОЖДЕНИЕ С ОРИГИНАЛОМ: на нуле остатка tweb зовёт голый `close()` (`:128-130`) —
// это глобальный `window.close` (своего `close` в модуле нет), то есть попытка закрыть
// окно приложения. Ветка не перенесена. Заменить её на `dispose()` нельзя: на первом
// (синхронном) прогоне `dispose` ещё не присвоен, а `eachTimeout` перезаводит таймер
// ПОСЛЕ колбэка, так что отмена изнутри колбэка его не останавливает. Тиканье
// останавливает владелец — `dispose` из результата (`onClose` подсказки, middleware
// плейсхолдера).
import eachSecond from '@helpers/eachSecond'
import { wrapSlowModeLeftDuration } from '@components/wrappers/wrapDuration'

/** tweb `:122-133` — живой остаток медленного режима (раз в секунду), `dispose` — остановить. */
export function slowModeTimer(getLeftDuration: () => number) {
  const s = document.createElement('span')
  const dispose = eachSecond(() => {
    const leftDuration = getLeftDuration()
    s.replaceChildren(wrapSlowModeLeftDuration(leftDuration))
  }, true)
  return { element: s, dispose }
}
