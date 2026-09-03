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
 * Закрыть текущий уровень чата — порт `setPeer({})` (appImManager.ts:2761-2774,
 * :2825-2828), тех её веток, у которых есть предмет в нашей модели: тумблер
 * таба на узком экране (:2771-2773, `mediaSizes.isFloatingLeftSidebar`) сюда
 * не входит — это уже закрыто другим механизмом (`App.tsx` backToList/
 * `useLeftColumnShown`), а не портом `setPeer`.
 *
 * Единственный ЗАКОННЫЙ вызывающий — `onPop` записи `im` (см.
 * `pushImRecordIfNeeded` ниже): запись из `appNavigationController` к этому
 * моменту УЖЕ снята (`backByItem`/`handleItem` сперва `spliceItems`, потом
 * зовут `onPop`), поэтому модель и стек записей остаются согласованы. Прямой
 * вызов из UI в обход контроллера (как раньше `closeTop()`/`selectChat(null)`
 * звались напрямую) оставил бы запись `im` висеть без соответствующего
 * уровня — история разъехалась бы с состоянием; такие места переведены на
 * `appNavigationController.back('im')` (Chat.tsx, useAppHotkeys.ts).
 */
export function closeChatLevel(): void {
  const stack = useChatStackStore.getState()
  // appImManager.ts:2768-2770 — chatIndex > 0 → spliceChats(chatIndex): срезать
  // верхний инстанс (тред/комментарии), чат остаётся открытым.
  if (stack.stack.length > 1) {
    stack.closeTop()
    return
  }
  // appImManager.ts:2825-2828 — иначе чат очищается целиком, таб уходит на список.
  useNavigationStore.getState().selectChat(null)
}

/**
 * Завести запись `im`, когда чат открывается при закрытом стеке (переход
 * «список → чат») — порт appImManager.ts:2628-2638: `prevTabId !== undefined
 * && id > prevTabId` внутри `id < APP_TABS.PROFILE || !findItemByType('im')`.
 *
 * У нас нет отдельного «таба» PROFILE — уровень ОДИН (чат открыт или нет), то
 * есть первая половина условия оригинала (`id < APP_TABS.PROFILE`) для нас
 * всегда истинна, а вторая половина (`!findItemByType('im')`) остаётся
 * ЕДИНСТВЕННЫМ гардом. Проверяется на КАЖДУЮ мутацию стека чатов (а не только
 * на переходе из пустого явной проверкой «было пусто, стало нет») — поэтому
 * важно, что уход вглубь (`setInnerPeer`, appImManager.ts:2831-2872) `selectTab`
 * САМ не зовёт: без этого гарда каждая мутация стека при уже открытом чате
 * пыталась бы завести вторую запись.
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
 * Запись `im` — наоборот, синхронизируется СРАЗУ (`pushImRecordIfNeeded()`
 * ниже вызовом, а не только подпиской): `useUrlSync`-эффект регистрируется
 * РАНЬШЕ этого (`App.tsx`: `useUrlSync()` перед `useEffect(startChatHistory)`)
 * и на самом первом маунте применяет хэш синхронно (`selectChat` внутри
 * `applyHash` без `await` для числового peerId) — стек чатов может стать
 * непустым ДО того, как эта подписка вообще встанет. Без начального вызова
 * первая открытая по хэшу вкладка осталась бы без записи `im` до следующей
 * мутации стека (открытия треда, смены чата).
 *
 * Возвращает отписку — вызывающий обязан снять её при размонтировании.
 */
export function startChatHistory(): () => void {
  const unsubStack = useChatStackStore.subscribe(() => {
    syncChatHash()
    pushImRecordIfNeeded()
  })
  const unsubNav = useNavigationStore.subscribe(syncChatHash)
  pushImRecordIfNeeded()
  return () => { unsubStack(); unsubNav() }
}
