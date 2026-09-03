// Пины трёх расхождений с оригиналом из докблока `chatHistory.ts`: смена чата
// не создаёт запись истории, хэш адресует пир ВЕРХНЕГО инстанса (без ветки
// треда), пустой стек — пустой хэш. Плюс пин на находку ревью задачи 1
// (Critical): черновик с известным username пишется в ДВА приёма
// (`selectChat('draft:<id>')`, потом отдельно `setDraftPeer`), и подписка
// обязана дожидаться ОБОИХ.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backChatLevel, hashForChat, startChatHistory, syncChatHash } from './chatHistory'
import { useChatStackStore } from '../../stores/chatStackStore'
import { useNavigationStore } from '../../stores/navigationStore'
import appNavigationController from './appNavigationController'

/** Открыть тред/комментарии поверх текущего верха стека — сокращение для
 *  повторяющегося набора опций в тестах ниже (`peerId`/`threadId` разные,
 *  форма одна и та же: tweb setInnerPeer({peerId, threadId})). */
const openThread = (peerId: number, threadId: number) =>
  useChatStackStore.getState().setInnerPeer({
    peerId,
    type: 'discussion',
    threadId,
    thread: { rootMsgId: threadId, title: '', kind: 'comments' },
  })

/** Очередь мутаций истории контроллера идёт через `setTimeout(…, 0)`
 *  (`appNavigationController.modifyHistoryFromEvent`) — даём ей пройти
 *  НЕСКОЛЬКО тиков (мутация может сама поставить в очередь следующую, как у
 *  Back: `legacySettleForBack` → `history.back()`), тот же приём и то же
 *  число тиков, что в `appNavigationController.test.ts:62-66`. */
const flush = async (times = 4) => {
  for (let i = 0; i < times; ++i) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

beforeEach(() => {
  useChatStackStore.getState().clear()
  useNavigationStore.setState({ selectedId: null, draftPeer: null })
})

afterEach(() => {
  useChatStackStore.getState().clear()
  // `appNavigationController` — синглтон, живой на весь файл: любой тест,
  // гоняющий `startChatHistory()` при непустом стеке (включая тесты хэша
  // выше — 'черновик' открывает draft-чат), заводит запись `im` (и, если
  // открывал тред, — `chat`). Без уборки здесь они пережили бы свой тест и
  // ломали бы первый же `toBeUndefined()` в следующем.
  appNavigationController.removeByType('im')
  appNavigationController.removeByType('chat')
})

describe('chatHistory', () => {
  it('смена чата НЕ создаёт записи истории', async () => {
    const push = vi.spyOn(history, 'pushState')
    useChatStackStore.getState().setPeer({ peerId: 42, type: 'chat' })
    syncChatHash()
    await flush()

    expect(push).not.toHaveBeenCalled()
    expect(location.hash).toBe('#42')
    push.mockRestore()
  })

  it('уход вглубь не меняет хэш: он адресует пир верхнего инстанса, а не ветку', async () => {
    useChatStackStore.getState().setPeer({ peerId: 42, type: 'chat' })
    useChatStackStore.getState().setInnerPeer({
      peerId: 77, type: 'discussion', threadId: 5,
      thread: { rootMsgId: 5, title: '', kind: 'comments' },
    })
    syncChatHash()
    await flush()

    expect(location.hash).toBe('#77')
  })

  it('пустой стек — пустой хэш', async () => {
    useChatStackStore.getState().setPeer({ peerId: 42, type: 'chat' })
    syncChatHash()
    await flush()

    useChatStackStore.getState().clear()
    syncChatHash()
    await flush()

    expect(location.hash).toBe('')
  })

  it('hashForChat: пустой стек даёт пустую строку без вызова контроллера', () => {
    expect(hashForChat()).toBe('')
  })

  it('черновик: @username из setDraftPeer тоже двигает хэш, а не только selectChat', async () => {
    const stop = startChatHistory()
    try {
      // Тот самый двухприёмный порядок из useNavigationActions.openPeer/
      // useUrlSync (резолв #@username): сначала selectChat кладёт peerId в
      // стек и обнуляет draftPeer, ЗАТЕМ отдельным вызовом приезжает сам peer.
      useNavigationStore.getState().selectChat('draft:777')
      await flush()
      useNavigationStore.getState().setDraftPeer({ id: 777, title: 'X', username: 'xuser' })
      await flush()

      expect(location.hash).toBe('#@xuser')
    } finally {
      stop()
    }
  })
})

/**
 * Записи `im`/`chat` — порт appImManager.ts:2628-2638 (пуш `im`, условие
 * `prevTabId !== undefined && id > prevTabId` внутри `id < APP_TABS.PROFILE
 * || !findItemByType('im')`), `chatsSelectTab` (:2255-2270, пуш `chat` на
 * КАЖДЫЙ уход глубже), `spliceChats` (:2689-2692, `removeByType('chat',
 * true)` на каждый срезанный уровень) и `setPeer({})` — всех её веток, что у
 * нас есть предмет (:2761-2774 глубина>1 → spliceChats(chatIndex); :2825-2828
 * иначе — чат очищается, таб уходит на список).
 *
 * ИСПРАВЛЕНИЕ ПОСЛЕ РЕВЬЮ: черновая версия этой задачи считала, что тип
 * `chat` в оригинале не производит никто («холостой» цикл `removeByType`) —
 * это было неверно: `chatsSelectTab` (appImManager.ts:2257-2270) заводит
 * ИМЕННО такую запись при уходе глубже (условие `idx > prevIdx` по DOM-
 * позиции контейнера, а контейнеры `createNewChat()` всегда `append`-ит).
 * Значит записей на самом деле ДВЕ: `im` — одна на факт «чат вообще открыт»
 * (список↔чат), `chat` — по одной на КАЖДЫЙ добавленный уровень глубины
 * (чат→тред→глубже). Back с глубины >1 снимает верхнюю `chat` (уровень
 * закрывается, чат остаётся); Back с глубины 1 снимает `im` (чат закрывается
 * целиком) — тот же общий `closeChatLevel`, что сам решает по глубине стека.
 *
 * `appNavigationController` — синглтон, живой на весь файл (не новый
 * инстанс, как в `appNavigationController.test.ts`, — `chatHistory.ts`
 * работает именно с синглтоном), поэтому убираем за собой обе записи и
 * мокаем `history.back`/`pushState`, чтобы не гонять реальную навигацию
 * jsdom между тестами — тот же приём, что `appNavigationController.test.ts:74-86`.
 */
describe('chatHistory — записи im/chat', () => {
  let backSpy: ReturnType<typeof vi.spyOn>
  let pushStateSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    backSpy = vi.spyOn(history, 'back').mockImplementation(() => {})
    pushStateSpy = vi.spyOn(history, 'pushState').mockImplementation(() => {})
  })

  afterEach(async () => {
    appNavigationController.removeByType('im')
    appNavigationController.removeByType('chat')
    await flush()
    backSpy.mockRestore()
    pushStateSpy.mockRestore()
  })

  it('открытие чата из списка кладёт РОВНО одну запись im', () => {
    const stop = startChatHistory()
    try {
      expect(appNavigationController.findItemByType('im')).toBeUndefined()
      useNavigationStore.getState().selectChat('42')
      expect(appNavigationController.findItemByType('im')).toBeDefined()
    } finally {
      stop()
    }
  })

  // Перевёрнутый пин (см. докблок выше): уход вглубь ДОБАВЛЯЕТ запись `chat`
  // — свою на каждый уровень, — а не вторую `im`. `im` остаётся одна.
  it('уход вглубь заводит запись chat, im остаётся одна', () => {
    const stop = startChatHistory()
    const pushSpy = vi.spyOn(appNavigationController, 'pushItem')
    try {
      useNavigationStore.getState().selectChat('42')
      expect(pushSpy).toHaveBeenCalledTimes(1) // im
      expect(appNavigationController.findItemByType('chat')).toBeUndefined()

      openThread(77, 5)

      expect(pushSpy).toHaveBeenCalledTimes(1) // im по-прежнему одна
      expect(appNavigationController.findItemByType('chat')).toBeDefined() // а запись уровня — новая
    } finally {
      pushSpy.mockRestore()
      stop()
    }
  })

  it('Back из треда срезает верхний инстанс, чат остаётся открытым', () => {
    const stop = startChatHistory()
    try {
      useNavigationStore.getState().selectChat('42')
      openThread(77, 5)
      expect(useChatStackStore.getState().stack).toHaveLength(2)

      backChatLevel()

      expect(useChatStackStore.getState().stack).toHaveLength(1)
      expect(useChatStackStore.getState().stack[0]?.peerId).toBe(42)
      expect(useNavigationStore.getState().selectedId).toBe('42')
    } finally {
      stop()
    }
  })

  it('Back из корневого чата закрывает чат', () => {
    const stop = startChatHistory()
    try {
      useNavigationStore.getState().selectChat('42')
      expect(useChatStackStore.getState().stack).toHaveLength(1)

      backChatLevel()

      expect(useChatStackStore.getState().stack).toHaveLength(0)
      expect(useNavigationStore.getState().selectedId).toBeNull()
    } finally {
      stop()
    }
  })

  // Сценарий из ревью: прежняя (одна запись на всю глубину) модель ломала
  // ИМЕННО эту последовательность — первый Back съедал единственную запись
  // целиком, второй Back уже ничего не закрывал. С im+chat раздельно первый
  // Back снимает chat (возврат в канал, чат открыт), второй — im (чат закрыт).
  it('два Back подряд: сначала закрывают тред, потом чат целиком', () => {
    const stop = startChatHistory()
    try {
      useNavigationStore.getState().selectChat('42')
      openThread(77, 5)
      expect(useChatStackStore.getState().stack).toHaveLength(2)

      backChatLevel() // первый Back — вернулись в канал, чат остаётся открытым
      expect(useChatStackStore.getState().stack).toHaveLength(1)
      expect(useChatStackStore.getState().stack[0]?.peerId).toBe(42)
      expect(useNavigationStore.getState().selectedId).toBe('42')

      backChatLevel() // второй Back — закрывает чат целиком
      expect(useChatStackStore.getState().stack).toHaveLength(0)
      expect(useNavigationStore.getState().selectedId).toBeNull()
    } finally {
      stop()
    }
  })

  // Глубина 3 (тред внутри треда) — единственный случай, где видна разница
  // между «контроллер уже снял ровно одну свою запись» (closeChatLevel сам
  // и есть тот onPop) и «снять ещё одну по счётчику дельты»: у глубины ≤ 2
  // разницы нет вовсе (см. докблок `syncChatRecords`/`closingViaRecord` в
  // chatHistory.ts) — оба Back'а глубины 2 находят компенсированный нуль.
  // Мутационный пин на снятие записей — здесь, а не на «двух Back подряд»
  // выше (см. сомнения в отчёте задачи).
  it('глубина 3: Back возвращает на глубину 2, а не сразу в список — запись chat второго уровня переживает', () => {
    const stop = startChatHistory()
    try {
      useNavigationStore.getState().selectChat('42')
      openThread(77, 5)
      openThread(88, 6)
      expect(useChatStackStore.getState().stack).toHaveLength(3)

      backChatLevel()

      expect(useChatStackStore.getState().stack).toHaveLength(2)
      expect(useChatStackStore.getState().stack[1]?.peerId).toBe(77)
      // Запись уровня 77 обязана пережить снятие записи уровня 88 — иначе
      // следующий Back не найдёт, чем закрыть ЭТОТ уровень, и провалится в
      // голый history.back() (appNavigationController.back: без найденной
      // записи типа — падает в history.back() безусловно).
      expect(appNavigationController.findItemByType('chat')).toBeDefined()

      backChatLevel()
      expect(useChatStackStore.getState().stack).toHaveLength(1)
      expect(useChatStackStore.getState().stack[0]?.peerId).toBe(42)
    } finally {
      stop()
    }
  })

  // ЭТО и есть настоящий мутационный пин на `removeByType('chat', true)` в
  // `syncChatRecords`: единственный путь у нас, где схлопывание НЕСКОЛЬКИХ
  // уровней разом идёт МИМО контроллера (не через Back/`closeChatLevel`, а
  // прямой мутацией `chatStackStore.setPeer` — «collapse to base» её ветки,
  // клик по ДРУГОМУ чату из списка, пока открыт вложенный тред). Ни
  // «Back из треда», ни «два Back подряд», ни «глубина 3» этот код не
  // задевают — там срез всегда на ОДИН уровень, и УЖЕ снят самим контроллером
  // (`backByItem` делает `spliceItems` ДО `onPop`), так что `removeByType`
  // там неизменно застаёт пустоту — см. сомнения в отчёте задачи.
  it('смена чата на ДРУГОЙ пир из глубины 3 срезает все уровни и их записи chat', () => {
    const stop = startChatHistory()
    try {
      useNavigationStore.getState().selectChat('42')
      openThread(77, 5)
      openThread(88, 6)
      expect(useChatStackStore.getState().stack).toHaveLength(3)
      expect(appNavigationController.findItemByType('chat')).toBeDefined()

      useNavigationStore.getState().selectChat('99') // клик по ДРУГОМУ чату в списке, не Back

      expect(useChatStackStore.getState().stack).toHaveLength(1)
      expect(useChatStackStore.getState().stack[0]?.peerId).toBe(99)
      expect(appNavigationController.findItemByType('chat')).toBeUndefined()
    } finally {
      stop()
    }
  })

  // НАХОДКА РЕВЬЮ (Important): у pushImRecordIfNeeded был пуш, но не было
  // симметричного снятия im при опустошении стека МИМО контроллера —
  // единственным путём снятия оставался back('im') (закрытие ЧЕРЕЗ запись).
  // Воспроизводимый триггер продакшна: useAuthGate.ts (локальный логаут,
  // onLoggingOut без migrateTo) → resetAccountStateInMemory() →
  // useChatStackStore.getState().clear() НАПРЯМУЮ, без appNavigationController
  // вообще; startChatHistory при этом не размонтируется (App.tsx, пустые
  // deps), синглтон контроллера тоже живёт — запись переживала логаут.
  it('опустошение стека мимо контроллера снимает im; следующий чат получает свежую запись', () => {
    const stop = startChatHistory()
    try {
      useNavigationStore.getState().selectChat('42')
      const firstIm = appNavigationController.findItemByType('im')?.item
      expect(firstIm).toBeDefined()

      // Опустошение МИМО контроллера — ровно то, что делает
      // resetAccountStateInMemory() (useAuthGate.ts): голый clear(), без
      // backChatLevel()/back('im').
      useChatStackStore.getState().clear()

      expect(appNavigationController.findItemByType('im')).toBeUndefined()

      // Следующий открытый чат (после повторного входа в ТОЙ ЖЕ вкладке)
      // обязан получить СВОЮ, отдельную запись — а не молчаливо остаться без
      // неё из-за гарда `!findItemByType('im')` в `pushImRecordIfNeeded`,
      // который принял бы чужую утёкшую запись за свою. Именно это и есть
      // настоящий вред — сам факт "запись снята" ловит первый expect выше,
      // а вот ЭТОТ ловит то, что снятие остаётся ТОЛЬКО декларацией без
      // последствий, если новая запись не заводится.
      useNavigationStore.getState().selectChat('99')
      const secondIm = appNavigationController.findItemByType('im')?.item
      expect(secondIm).toBeDefined()
      expect(secondIm).not.toBe(firstIm)
    } finally {
      stop()
    }
  })

  it('смена чата на другой из списка новой записи не добавляет', () => {
    const stop = startChatHistory()
    const pushSpy = vi.spyOn(appNavigationController, 'pushItem')
    try {
      useNavigationStore.getState().selectChat('42')
      expect(pushSpy).toHaveBeenCalledTimes(1)

      useNavigationStore.getState().selectChat('43')
      expect(pushSpy).toHaveBeenCalledTimes(1)
    } finally {
      pushSpy.mockRestore()
      stop()
    }
  })
})
