// Хэш открытого чата — пишется НА МЕСТЕ, без записи истории браузера.
//
// Порт tweb/src/lib/appImManager.ts:2578-2597 (`overrideHash`, вызов из
// `selectTab`) и tweb/src/components/appNavigationController.ts:274-288/411-423
// (сам `overrideHash` → `replaceState`). Единственный писатель этого хэша:
// собственных `history.*` здесь нет — запись отдаётся
// `appNavigationController.overrideHash`, который её и переписывает поверх
// текущей записи (в отличие от `pushHashState`, у которого своя запись на
// каждый чат — ОСТАТОК #108, см. докблок `appNavigationController.pushHashState`).
//
// ГЛАВНОЕ ОТЛИЧИЕ ОТ ПРЕЖНЕГО `useUrlSync.hashForState`: там открытый тред
// давал суффикс `_rootMsgId` — в оригинале такой ветки в хэше НЕТ ВООБЩЕ:
// `appImManager.ts:2597` пишет `this.chat?.peerId`, то есть пир ВЕРХНЕГО
// инстанса стека чатов и только его. Уход в тред (комментарии, форум-топик)
// меняет верхний инстанс — значит меняет и адресуемый пир, но без всякого
// намёка на ветку в самой строке хэша.
import { useChatStackStore, selectActive } from '../../stores/chatStackStore'
import { useNavigationStore } from '../../stores/navigationStore'
import { cachedChat } from '../peerCache'
import appNavigationController from './appNavigationController'

/** Хэш открытого состояния БЕЗ ведущего `#`. '' — список чатов (стек пуст). */
export function hashForChat(): string {
  const active = selectActive(useChatStackStore.getState())
  if (!active) return ''

  // Черновик (диалога ещё нет, ничего не отправлено): в стеке уже лежит
  // настоящий числовой peerId — `navigationStore.selectChat` разворачивает
  // `draft:<id>` в `stack.setPeer` при открытии. Делиться этим числом нельзя:
  // после reload по нему нечего открывать, это не диалог. Пишем `@username`,
  // если он есть у собеседника, иначе не пишем вовсе — правило дословно из
  // прежнего `useUrlSync.hashForState`.
  const nav = useNavigationStore.getState()
  if (nav.selectedId?.startsWith('draft:')) {
    return nav.draftPeer?.username ? `@${nav.draftPeer.username}` : ''
  }

  // Публичный чат/канал/группа с username → #@username (шарибельно, как tweb);
  // иначе числовой id (у private-чатов username в диалоге нет). Правило
  // дословно из прежнего `useUrlSync.hashForState` (:36-42).
  const chat = cachedChat(active.peerId)
  return chat && chat._ === 'channel' && chat.username ? `@${chat.username}` : String(active.peerId)
}

/**
 * Посчитать хэш и отдать контроллеру навигации — он единственный, кто трогает
 * историю браузера. `overrideHash` переписывает текущую запись НА МЕСТЕ
 * (`replaceState`): смена чата не создаёт новую запись истории, Back между
 * чатами не ходит — ровно как в оригинале (снятие ОСТАТКА #108).
 */
export function syncChatHash(): void {
  appNavigationController.overrideHash(hashForChat())
}

/**
 * Флаг «текущая мутация стека вызвана самим `closeChatLevel`» — то есть уже
 * идёт КАК `onPop` записи, которую контроллер только что снял
 * (`backByItem`/`handleItem` делают `spliceItems` ДО вызова `onPop`,
 * appNavigationController.ts:406-414). `syncChatRecords` (ниже) на такую
 * мутацию не должен снимать ЕЩЁ одну запись `chat` — та единственная запись,
 * что отвечала за срезаемый уровень, физически уже снята контроллером;
 * повторное снятие задело бы ЧУЖУЮ, ещё живую запись соседнего уровня.
 */
let closingViaRecord = false

/**
 * Закрыть текущий уровень чата — порт `setPeer({})` (appImManager.ts:2761-2774,
 * :2825-2828), тех её веток, у которых есть предмет в нашей модели: тумблер
 * таба на узком экране (:2771-2773, `mediaSizes.isFloatingLeftSidebar`) сюда
 * не входит — это уже закрыто другим механизмом (`App.tsx` backToList/
 * `useLeftColumnShown`), а не портом `setPeer`.
 *
 * Общий `onPop` ОБЕИХ записей контроллера — `im` (`pushImRecordIfNeeded`) И
 * `chat` (`syncChatRecords`), как и в оригинале: `chat.ts:1628-1632` зовёт
 * `back(isFirstChat ? 'im' : 'chat')`, но обе ведут к одному и тому же
 * `setPeer({}, canAnimate)`. Единственный ЗАКОННЫЙ вызывающий — эти `onPop`:
 * к моменту вызова СНЯТАЯ контроллером запись уже вышла из
 * `navigations[]`, поэтому модель и стек записей остаются согласованы. Прямой
 * вызов из UI в обход контроллера (как раньше `closeTop()`/`selectChat(null)`
 * звались напрямую) оставил бы запись висеть без соответствующего уровня —
 * история разъехалась бы с состоянием; такие места переведены на
 * `backChatLevel()` (см. ниже; вызывающие — Chat.tsx, useAppHotkeys.ts).
 */
export function closeChatLevel(): void {
  const stack = useChatStackStore.getState()
  closingViaRecord = true
  try {
    // appImManager.ts:2768-2770 — chatIndex > 0 → spliceChats(chatIndex): срезать
    // верхний инстанс (тред/комментарии), чат остаётся открытым.
    if (stack.stack.length > 1) {
      stack.closeTop()
      return
    }
    // appImManager.ts:2825-2828 — иначе чат очищается целиком, таб уходит на список.
    useNavigationStore.getState().selectChat(null)
  } finally {
    closingViaRecord = false
  }
}

/**
 * Закрыть текущий уровень чата ЗАПИСЬЮ навигации — порт стрелки «назад» в
 * шапке (`tweb/src/components/chat/chat.ts:1628-1632`):
 * `appNavigationController.back(isFirstChat ? 'im' : 'chat')`. «isFirstChat» —
 * это глубина стека === 1 (только корень, без треда/комментариев поверх):
 * тогда закрывается запись `im` (чат целиком), иначе — верхняя запись `chat`
 * (срезает только текущий уровень, чат остаётся открытым; `closeChatLevel`
 * сам разберётся, какой из двух случаев).
 *
 * ЕДИНСТВЕННАЯ точка, которой обязаны звать UI-действия «закрыть чат/
 * уровень» (крестик в шапке треда, Esc) — сами `chatStackStore.closeTop()`/
 * `navigationStore.selectChat(null)` они звать не должны: иначе запись
 * контроллера переживёт закрытый на экране уровень.
 */
export function backChatLevel(): void {
  const depth = useChatStackStore.getState().stack.length
  appNavigationController.back(depth > 1 ? 'chat' : 'im')
}

/**
 * Завести запись `im`, когда чат открывается при закрытом стеке (переход
 * «список → чат») — порт appImManager.ts:2628-2638: `prevTabId !== undefined
 * && id > prevTabId` внутри `id < APP_TABS.PROFILE || !findItemByType('im')`.
 *
 * У нас нет отдельного «таба» PROFILE — уровень «список ↔ чат» ОДИН, то есть
 * первая половина условия оригинала (`id < APP_TABS.PROFILE`) для нас всегда
 * истинна, а вторая половина (`!findItemByType('im')`) остаётся ЕДИНСТВЕННЫМ
 * гардом. Проверяется на КАЖДУЮ мутацию стека чатов (а не только на переходе
 * из пустого явной проверкой «было пусто, стало нет») — поэтому важно, что
 * уход вглубь (`setInnerPeer`, appImManager.ts:2831-2872) `selectTab` САМ не
 * зовёт: без этого гарда каждая мутация стека при уже открытом чате пыталась
 * бы завести вторую запись `im`. Записи `chat` на уход вглубь — отдельный
 * механизм, `syncChatRecords` ниже.
 */
function pushImRecordIfNeeded(): void {
  const stack = useChatStackStore.getState().stack
  if (!stack.length) return
  if (appNavigationController.findItemByType('im')) return

  appNavigationController.pushItem({
    type: 'im',
    // appImManager.ts:2633-2636 — onPop: (canAnimate) => this.setPeer({}, canAnimate).
    // Параметр canAnimate closeChatLevel не нужен: у нас переход анимирует CSS
    // по смене состояния сторов, а не JS-таймер поверх `canAnimate`.
    onPop: () => closeChatLevel(),
  })
}

/**
 * Сколько записей `chat` СЕЙЧАС держит контроллер — модульный счётчик, а не
 * производная от стека на лету: к моменту РЕАКЦИИ на мутацию глубина стека
 * уже новая, и без запомненного «было» нельзя посчитать дельту (сколько
 * завести или снять). Сбрасывается в `startChatHistory()` — единственный
 * писатель `chat`-записей это модуль, и свежий старт подписки обязан начинать
 * счёт с нуля, а не тащить состояние прошлого монтирования (актуально и для
 * тестов: `appNavigationController` — синглтон на весь файл).
 */
let chatRecordCount = 0

/**
 * Держит записи `chat` контроллера синхронными с глубиной стека — порт
 * `chatsSelectTab` (appImManager.ts:2255-2270, пуш `type: 'chat'` при
 * `idx > prevIdx` — у нас это ЛЮБОЙ уход глубже) и `spliceChats`
 * (:2689-2692, `removeByType('chat', true)` на каждый срезанный уровень).
 *
 * У КАЖДОГО уровня стека, кроме корня (index 0), — своя запись `chat`:
 * нужных записей `Math.max(0, depth - 1)`. Разница со СЧЁТЧИКОМ (см. выше)
 * решает, пушить новые или снимать лишние.
 *
 * Пуш вставляется, как в оригинале, через `context`/`findItem`/`spliceItems`
 * (appImManager.ts:2258-2267): `context` — id инстанса конкретного уровня
 * стека (`ChatInstanceDesc.id`), `found` — уже заведённая для НЕГО запись. В
 * нашей модели `id` инстанса не переиспользуется (растущий счётчик в
 * `chatStackStore`), поэтому `found` практически всегда `undefined` — ветка
 * оставлена ради структурного паритета с оригиналом, а не потому что живая.
 *
 * Снятие лишних ПРОПУСКАЕТСЯ, когда мутацию вызвал сам `closeChatLevel`
 * (флаг `closingViaRecord`, см. его докблок) — контроллер уже снял РОВНО одну
 * свою запись до этого вызова, второй раз снимать нечего.
 */
function syncChatRecords(): void {
  const stack = useChatStackStore.getState().stack
  const wanted = Math.max(0, stack.length - 1)

  if (wanted > chatRecordCount) {
    for (let level = chatRecordCount + 1; level <= wanted; level++) {
      const instanceId = stack[level].id
      const found = appNavigationController.findItem((item) => item.context === instanceId)
      appNavigationController.spliceItems(
        found ? found.index : appNavigationController.getNextIndex(),
        0,
        {
          type: 'chat',
          context: instanceId,
          // appImManager.ts:2264-2267 — тот же onPop, что у im: setPeer({}, canAnimate).
          onPop: () => closeChatLevel(),
        },
      )
    }
  } else if (wanted < chatRecordCount && !closingViaRecord) {
    for (let i = wanted; i < chatRecordCount; i++) {
      appNavigationController.removeByType('chat', true)
    }
  }

  chatRecordCount = wanted
}

/**
 * Подписка «факты хэша → хэш». Хэш собирается из ДВУХ сторов
 * (`hashForChat` выше), и меняться каждый из них может НЕЗАВИСИМО — подписки
 * на один `chatStackStore` для этого недостаточно.
 *
 * `navigationStore.selectChat` — единственный писатель `chatStackStore.
 * setPeer`/`clear` — синхронно зеркалит выбор чата в стек, и это ловит открытие/
 * закрытие треда (`setInnerPeer`/`closeTop`), которые стор трогают напрямую.
 * НО черновик (диалога ещё нет) пишется в ДВА приёма: `openPeer`
 * (`useNavigationActions.ts`) и резолв `#@username` через директорию
 * (`useUrlSync.ts`) сперва зовут `selectChat('draft:<id>')` (кладёт peerId в
 * стек, `draftPeer` при этом ещё `null` — `selectChat` сам его обнуляет), и
 * ТОЛЬКО ВТОРЫМ вызовом — `setDraftPeer(peer)`, который `chatStackStore` не
 * трогает вовсе. Подписка только на стек ловит первый приём (даёт пустой хэш,
 * потому что `draftPeer` ещё не подъехал) и пропускает второй — адрес так и
 * остаётся пустым вместо `#@username`. Порт того же принципа, что у оригинала:
 * `overrideHash` там зовётся не только из `selectTab` (appImManager.ts:2597),
 * но и по `peer_changed` (appImManager.ts:708)/`peer_title_edit` (:411) — то
 * есть при изменении самого пира, а не только при смене таба. Поэтому вторая
 * подписка — на `navigationStore` целиком (в нём кроме `selectedId`/`draftPeer`
 * фактов для хэша нет, сужать срез незачем).
 *
 * Первый снимок хэша НЕ синхронизируется здесь нарочно: на монтировании хэш
 * из адресной строки ещё не применён к сторам (`useUrlSync` делает это
 * асинхронно — резолвит @username, дожидается диалогов). Досрочный вызов
 * увидел бы пустое состояние и стёр бы входящий хэш до того, как он
 * применится. Как только применение допишет стор, подписка отработает сама.
 *
 * Записи `im`/`chat` — наоборот, синхронизируются СРАЗУ (вызовом ниже, а не
 * только подпиской): `useUrlSync`-эффект регистрируется РАНЬШЕ этого
 * (`App.tsx`: `useUrlSync()` перед `useEffect(startChatHistory)`) и на самом
 * первом маунте применяет хэш синхронно (`selectChat` внутри `applyHash` без
 * `await` для числового peerId) — стек чатов может стать непустым ДО того,
 * как эта подписка вообще встанет. Без начального вызова первая открытая по
 * хэшу вкладка осталась бы без записи `im` до следующей мутации стека
 * (открытия треда, смены чата).
 *
 * Возвращает отписку — вызывающий обязан снять её при размонтировании.
 */
export function startChatHistory(): () => void {
  // Свежий старт подписки — свежий счёт `chat`-записей (см. докблок
  // `chatRecordCount`): у продакшна это разница не играет (вызывается один
  // раз на вкладку), у тестов — играет, `appNavigationController` там
  // синглтон на весь файл.
  chatRecordCount = 0
  const unsubStack = useChatStackStore.subscribe(() => {
    syncChatHash()
    pushImRecordIfNeeded()
    syncChatRecords()
  })
  const unsubNav = useNavigationStore.subscribe(syncChatHash)
  pushImRecordIfNeeded()
  syncChatRecords()
  return () => { unsubStack(); unsubNav() }
}
