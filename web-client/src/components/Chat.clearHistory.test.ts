// src/components/Chat.clearHistory.test.ts
//
// Пин одной строки проводки в `Chat.tsx`: после успешной «Очистить историю»
// окно ЗАМЕНЯЕТСЯ в зеркале (`replaceMirrorWindow(key, [])`), а не оставляется
// на волю следующей загрузки.
//
// Почему это вообще проводка, а не деталь. `putMirrorPage` умеет только СЛИТЬ
// страницу с окном, поэтому пустой ответ сервера после очистки НЕ вытесняет из
// зеркала прошлую историю. Без явной замены зеркало держит стёртые сообщения:
// Ctrl+↑ предлагает ответить на сообщение, которого на экране нет, а
// `mirrorMsgs.length === 0` (приветствие бота и клавиатура ответа в том же
// файле) не становится истиной никогда. Удаление строки не красит ни одного
// другого теста — ровно тот случай, который норма покрытия
// (web-client/CLAUDE.md, «Тесты») требует закрыть.
//
// Почему СКАН ИСХОДНИКА, а не рендер компонента: `Chat.tsx` — заявленное в
// той же норме исключение, её не импортирует ни один тест и отрендерить в
// vitest нельзя. Приём тот же, что у соседнего `Chat.feedMount.test.ts` и у
// `core/scrollWriters.test.ts` / `stores/noManualOrder.test.ts`.
//
// Оригинал: очистивший историю владелец объявляет зеркалу `delete` сам —
// tweb `appMessagesManager.flushHistory` → `flushStoragesByPeerId`
// (src/lib/appManagers/appMessagesManager.ts:4709, :4732-4742), вкладка
// исполняет `clearHistoryStorage` (src/lib/apiManagerProxy.ts:282 → :542-563,
// `slicedArray.slices.splice(0, Infinity)`).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHAT_TSX = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8')

// Тело `doClearHistory` — от объявления до закрывающей скобки на нулевом
// отступе функции.
const DO_CLEAR = CHAT_TSX.match(/const doClearHistory = \(\) => \{[\s\S]*?\n {2}\}/)?.[0] ?? ''

describe('Chat.tsx — «Очистить историю» заменяет окно в зеркале', () => {
  it('doClearHistory на месте', () => {
    expect(DO_CLEAR).not.toBe('')
  })

  it('после ответа сервера окно заменяется пустым — по ключу ЭТОГО окна', () => {
    expect(DO_CLEAR).toContain('replaceMirrorWindow(winKey(numericChatId, threadRootId), [])')
    // Именно замена: слияние здесь бессмысленно — сливать пустоту не с чем.
    expect(DO_CLEAR).not.toContain('putMirrorPage')
  })

  it('замена стоит ПОСЛЕ успеха сервера и ДО перезагрузки ленты', () => {
    const clear = DO_CLEAR.indexOf('managers.chats.clearHistory')
    const replace = DO_CLEAR.indexOf('replaceMirrorWindow')
    const reload = DO_CLEAR.indexOf('feedApi.current?.reload()')
    expect(clear).toBeGreaterThanOrEqual(0)
    expect(replace).toBeGreaterThan(clear)
    expect(reload).toBeGreaterThan(replace)
  })

  it('примитив импортирован из зеркала', () => {
    expect(CHAT_TSX).toMatch(/^import \{ replaceMirrorWindow, winKey \} from '\.\.\/core\/history\/messagesMirror'$/m)
  })
})
