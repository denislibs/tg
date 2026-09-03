// Хэш открытого чата — пишется НА МЕСТЕ, без записи истории браузера.
//
// Порт tweb/src/lib/appImManager.ts:2578-2597 (`overrideHash`, вызов из
// `selectTab`) и tweb/src/components/appNavigationController.ts:274-288/411-423
// (сам `overrideHash` → `replaceState`). Единственный писатель этого хэша:
// собственных `history.*` здесь нет — запись отдаётся
// `appNavigationController.overrideHash`, который её и переписывает поверх
// текущей записи (ОСТАТОК #108 — метод `pushHashState`, у которого была своя
// запись на каждый чат, — снят задачей 4: единственный писатель истории
// теперь ровно контроллер, других путей записи в клиенте нет).
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
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import { usePipStore } from '../pip'

/**
 * Хэш открытого состояния БЕЗ ведущего `#`. '' — список чатов (стек пуст ИЛИ
 * не показан — см. проверку `selectedId` ниже).
 *
 * НАХОДКА РЕВЬЮ (Critical, п.1): раньше хэш читался ИСКЛЮЧИТЕЛЬНО из стека
 * (`chatStackStore`), а на узком экране закрытие чата стрелкой «назад»
 * сохраняло смонтированный инстанс (стек НЕ трогается — см. ветки
 * `isFloatingLeftSidebar` и `ScreenSize.mobile` в `closeChatLevel` ниже), поэтому хэш
 * оставался прежним (`#42`) при видимом списке чатов. Порт: у tweb хэш
 * завязан на выбранный ТАБ, а не на массив `chats[]` — `selectTab`
 * (appImManager.ts:2591-2597) зовёт `overrideHash(id > CHATLIST ?
 * this.chat?.peerId : undefined)`, то есть при уходе на CHATLIST хэш ВСЕГДА
 * `undefined`, даже если верхний инстанс `this.chat` жив и не тронут. Роль
 * `id > CHATLIST` у нас играет `navigationStore.selectedId !== null`.
 */
export function hashForChat(): string {
  const nav = useNavigationStore.getState()
  if (!nav.selectedId) return ''

  const active = selectActive(useChatStackStore.getState())
  if (!active) return ''

  // Черновик (диалога ещё нет, ничего не отправлено): в стеке уже лежит
  // настоящий числовой peerId — `navigationStore.selectChat` разворачивает
  // `draft:<id>` в `stack.setPeer` при открытии. Делиться этим числом нельзя:
  // после reload по нему нечего открывать, это не диалог. Пишем `@username`,
  // если он есть у собеседника, иначе не пишем вовсе — правило дословно из
  // прежнего `useUrlSync.hashForState`.
  if (nav.selectedId.startsWith('draft:')) {
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
 * :2822-2828), включая ОБЕ ветки оригинала, сохраняющие смонтированный
 * инстанс: плавающий сайдбар (:2771-2773, `mediaSizes.isFloatingLeftSidebar`)
 * и мобильный экран (:2822 — при пустом `peerId` `chat.setPeer({})` на
 * `ScreenSize.mobile` не зовётся вовсе). Они ПОРТИРОВАНЫ СЮДА (находка ревью,
 * Critical п.1), а не снаружи (`App.tsx`): у оригинала это ветка внутри
 * `setPeer`, то есть срабатывает уже ПОСЛЕ того, как контроллер снял запись
 * (`im`/`chat`) — ровно как остальные ветки этой функции. Прежняя реализация
 * звала `nav.setSelectedId(null)` напрямую из `App.tsx::backToList`, минуя
 * контроллер целиком: запись `im` не снималась, хэш (читавшийся только из
 * стека) не менялся — Back/Esc после такого закрытия били мимо, а F5
 * открывал чат вместо списка.
 *
 * Общий `onPop` ОБЕИХ записей контроллера — `im` (`pushImRecordIfNeeded`) И
 * `chat` (`syncChatRecords`), как и в оригинале: `chat.ts:1628-1632` зовёт
 * `back(isFirstChat ? 'im' : 'chat')`, но обе ведут к одному и тому же
 * `setPeer({}, canAnimate)`. К моменту вызова СНЯТАЯ контроллером запись уже
 * вышла из `navigations[]`, поэтому модель и стек записей остаются
 * согласованы. Прямой вызов из UI в обход контроллера (как раньше
 * `closeTop()`/`selectChat(null)` звались напрямую) оставил бы запись висеть
 * без соответствующего уровня — история разъехалась бы с состоянием; такие
 * места переведены на `backChatLevel()` (см. ниже; вызывающие — Chat.tsx
 * (крестик в шапке треда), `useAppHotkeys.ts` (Esc), `App.tsx` (стрелка
 * «назад» узкого экрана)).
 *
 * ВТОРОЙ законный прямой вызывающий — `options.isDeleting` (см. параметр):
 * порт `chat.ts:658-668`/`input.ts:1496`, где `appImManager.setPeer(
 * {isDeleting: true})` зовётся НАПРЯМУЮ, тоже в обход Back/записи — событие
 * «диалог выпал из списка» (вышли/удалили) может прийти, пока запись ещё
 * жива на любой глубине, и закрыть чат обязано само это событие, а не
 * дожидаться, пока пользователь нажмёт Back. Эта ветка НЕ ставит
 * `closingViaRecord`: в отличие от `onPop`, здесь контроллер заранее НИЧЕГО
 * не снимал (нет предшествующего `backByItem`/`spliceItems`) — снятие `im`/
 * `chat` обязана сделать сама подписка на пустой стек, симметрично прямому
 * `chatStackStore.clear()` (см. «находку ревью Important» в `syncChatRecords`
 * ниже — тот же класс мутации «мимо записи», а не «через запись»).
 */
export function closeChatLevel(options: { isDeleting?: boolean } = {}): void {
  // appImManager.ts:2761-2764 — isDeleting проверяется ПЕРВЫМ и безусловно
  // (до chatIndex>0 и до isFloatingLeftSidebar): чат, из которого вышли/
  // который удалили, не имеет смысла ни держать смонтированным на узком
  // экране, ни оставлять открытым уровнем ниже — стек обязан схлопнуться
  // целиком, а не только верхний уровень. Вне `closingViaRecord`-блока —
  // см. докблок функции.
  if (options.isDeleting) {
    useNavigationStore.getState().selectChat(null)
    return
  }

  const stack = useChatStackStore.getState()
  closingViaRecord = true
  try {
    // appImManager.ts:2768-2770 — chatIndex > 0 → spliceChats(chatIndex): срезать
    // верхний инстанс (тред/комментарии), чат остаётся открытым.
    if (stack.stack.length > 1) {
      stack.closeTop()
      return
    }
    // appImManager.ts:2771-2773 — mediaSizes.isFloatingLeftSidebar: узкий
    // экран лишь переключает таб на список (`selectTab`), верхний инстанс
    // (`this.chats`) не трогается — он остаётся смонтированным, повторное
    // открытие того же чата не ремонтит его. Роль `this.tabId` у нас играет
    // `navigationStore.selectedId`, роль `this.chats[]` — `chatStackStore`:
    // ветка снимает выбор БЕЗ очистки стека (`setSelectedId`, не `selectChat`).
    // `hashForChat()` при этом сама уходит в '' (проверка `selectedId` в её
    // докблоке) — хэш активного чата закрывается вместе с записью.
    //
    // РАСХОЖДЕНИЕ С ОРИГИНАЛОМ, НАЗВАННОЕ: у tweb здесь ТУМБЛЕР —
    // `selectTab(+!this.tabId)`, то есть при УЖЕ активном табе списка он бы
    // чат ВЕРНУЛ. Вторая половина тумблера (список → чат) портирована не
    // сюда, а в `toggleChatIfMedium` (chat.ts:1619-1626) — откуда её зовёт и
    // оригинал: в `Chat.pop()` ДО `appNavigationController.back(...)`. Сюда
    // управление приходит ТОЛЬКО как `onPop` живой записи `im`/`chat` (либо
    // прямым `isDeleting` выше), а запись живёт ровно пока показан чат —
    // значит таб здесь гарантированно «чат», и обе половины тумблера дали бы
    // один и тот же результат. Разведены они по двум функциям потому, что у
    // нас нет объекта `Chat` с методом `pop()`: «жать назад» и «закрыть
    // уровень» — две разные функции этого модуля (`backChatLevel` и эта).
    //
    // `usePipStore().active` — сигнал, которого у tweb НЕТ: у нас есть
    // отдельный режим «всё приложение в Document PiP» (см. `core/pip.ts`),
    // тоже принудительно однаколоночный, но PiP-окно узкое НЕЗАВИСИМО от
    // ширины ОСНОВНОГО окна, к которому привязан `mediaSizes` (слушает
    // `window.resize` того окна, где он создан, — см. докблок `core/dom/
    // mediaSizes.ts`). Без этого добавления закрытие чата в узком PiP-окне
    // на широком основном экране ошибочно ушло бы в ветку полной очистки
    // (ниже) вместо сохранения инстанса — названное расширение порта, не
    // третий сигнал «своей» природы: то же самое `narrow`, что уже
    // складывает `App.tsx` (`useMediaQuery('(max-width:900px)') || pipActive`).
    if (mediaSizes.isFloatingLeftSidebar || usePipStore.getState().active) {
      useNavigationStore.getState().setSelectedId(null)
      return
    }
    // appImManager.ts:2822 — `if(peerId || mediaSizes.activeScreen !== ScreenSize.mobile)`:
    // при ПУСТОМ peerId на мобиле `chat.setPeer({})` не зовётся ВОВСЕ, то есть
    // инстанс сохраняет свой пир — то же сохранение, что даёт ветка плавающего
    // сайдбара выше, но ДРУГИМ кодом оригинала; дальше на мобиле идёт только
    // `selectTab(CHATLIST)` (:2826).
    //
    // НАХОДКА РЕВЬЮ (Important): без этой ветки телефон (ширина ≤600 →
    // `ScreenSize.mobile`, где `isFloatingLeftSidebar` ЛОЖНА — она требует
    // `activeScreen === medium`) проваливался в полную очистку ниже, и
    // смонтированный инстанс размонтировался. Такого нет ни у оригинала, ни
    // у нашего прежнего кода (`App.tsx::backToList` сохранял инстанс на всех
    // ширинах ≤900) — регресс, внесённый переносом ветки узкого экрана внутрь
    // этой функции по одному лишь `isFloatingLeftSidebar`.
    if (mediaSizes.activeScreen === ScreenSize.mobile) {
      useNavigationStore.getState().setSelectedId(null)
      return
    }
    // appImManager.ts:2822-2823 + :2825-2828 — не-мобильный экран: инстансу
    // чистят пир (`chat.setPeer({})`), и таб уходит на список. `selectChat(null)`
    // делает разом ровно эти две вещи (`chatStackStore.clear()` + `selectedId = null`).
    useNavigationStore.getState().selectChat(null)
  } finally {
    closingViaRecord = false
  }
}

/**
 * Порт `Chat.toggleChatIfMedium` (tweb chat.ts:1619-1626) — ПЕРВОЕ, что делает
 * `Chat.pop()` (:1628-1632, стрелка «назад» в шапке): на экране `medium` при
 * показанном списке чатов «назад» не закрывает НИЧЕГО, а возвращает чат —
 * `appImManager.setPeer({peerId: this.peerId})`, который на том же экране
 * уходит в ветку «тот же пир» (appImManager.ts:2799-2802: `isSamePeer &&
 * activeScreen <= medium && LEFT_COLUMN_ACTIVE` → `selectTab(APP_TABS.CHAT)`).
 * То есть стрелка на этой ширине — ТУМБЛЕР список↔чат, а не «выход».
 *
 * НАХОДКА РЕВЬЮ (Critical): без этого порта второе нажатие «назад» уводило из
 * приложения. В полосе 601-925 стрелка после закрытия чата ОСТАЁТСЯ на экране
 * (колонка чата не скрыта, а сдвинута — `styles/tweb/_chat.scss:464-470`,
 * `respond-to(floating-left-sidebar)`), и второе нажатие звало
 * `back('im')` — а записи `im` уже нет, она снята первым нажатием, — после
 * чего `appNavigationController.back` падал в голый `history.back()` и
 * выбрасывал за пределы SPA.
 *
 * Соответствия ролей:
 *  • `mediaSizes.activeScreen === ScreenSize.medium` — дословно из оригинала
 *    (именно `activeScreen`, не `isFloatingLeftSidebar`; для medium они
 *    совпадают: `medium` = 601..925 = `isLessThanFloatingLeftSidebar`).
 *    `usePipStore().active` подмешан по той же причине, что и в
 *    `closeChatLevel` (см. её комментарий) — узкое PiP-окно;
 *  • `document.body.classList.contains(LEFT_COLUMN_ACTIVE)` — у нас
 *    `navigationStore.selectedId === null`: класс на body И ЕСТЬ производная
 *    от него (`App.tsx`: `useLeftColumnShown(selectedId !== null)`), и читать
 *    первоисточник надёжнее, чем ждать, пока React прогонит layout-эффект;
 *  • `this.peerId` (пир возвращаемого инстанса) — корень стека: тумблер
 *    достижим только при закрытом чате, а закрытие с глубины >1 срезает
 *    уровень и таб не трогает, значит в стеке здесь ровно один инстанс.
 *    Строку-id `navigationStore` собираем обратно из него: `draft:<peerId>`,
 *    если пережил `draftPeer` того же пира (у tweb пространства имён
 *    `draft:` нет вовсе — там id таба это сам peerId), иначе просто число;
 *  • пуш `im` после смены таба — порт `selectTab` (appImManager.ts:2628-2638):
 *    переход CHATLIST → CHAT заводит запись. Без него следующий Back снова
 *    не нашёл бы, что снимать. Порядок тот же, что у оригинала: сперва таб,
 *    потом запись.
 */
function toggleChatIfMedium(): boolean {
  const isMedium = mediaSizes.activeScreen === ScreenSize.medium || usePipStore.getState().active
  const nav = useNavigationStore.getState()
  if (!isMedium || nav.selectedId !== null) return false

  const root = useChatStackStore.getState().stack[0]
  if (!root) return false

  nav.setSelectedId(nav.draftPeer?.id === root.peerId ? `draft:${root.peerId}` : String(root.peerId))
  pushImRecordIfNeeded()
  return true
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
 * уровень» (крестик в шапке треда, Esc, стрелка «назад» в шапке узкого
 * экрана — `App.tsx::backToList`) — сами `chatStackStore.closeTop()`/
 * `navigationStore.selectChat(null)`/`setSelectedId(null)` они звать не
 * должны: иначе запись контроллера переживёт закрытый на экране уровень.
 * Исключение — `closeChatLevel({isDeleting: true})`, см. её докблок.
 */
export function backChatLevel(): void {
  // chat.ts:1629 — `if(this.toggleChatIfMedium()) return;` ПЕРЕД разбором
  // глубины: на medium с показанным списком «назад» возвращает чат, а не
  // снимает запись (см. докблок `toggleChatIfMedium`).
  if (toggleChatIfMedium()) return

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
 * Плюс симметричное снятие `im` при опустошении стека — см. отдельный блок
 * внизу функции и его докблок.
 *
 * У КАЖДОГО уровня стека, кроме корня (index 0), — своя запись `chat`:
 * нужных записей `Math.max(0, depth - 1)`. Разница со СЧЁТЧИКОМ (см. выше)
 * решает, пушить новые или снимать лишние.
 *
 * Пуш вставляется, как в оригинале, через `context`/`findItem`/`spliceItems`
 * (appImManager.ts:2258-2267): по форме вызова читается, будто `found` ищет
 * УЖЕ заведённую запись для конкретного уровня и переиспользует её место.
 *
 * ПОПРАВКА (находка ревью, Minor п.5б): это неверно и про наш код, и про
 * оригинал — `found` мёртв ПО ПОСТРОЕНИЮ, а не «практически всегда» из-за
 * наших неповторяемых id. У tweb сам пушимый item (appImManager.ts:2262-2267)
 * поле `context` НЕ ЗАДАЁТ ВООБЩЕ (`{type: 'chat', onPop: …}`), поэтому
 * `findItem((item) => item.context === chat)` там не находит НИЧЕГО никогда —
 * это дословно перенесённая структура вызова оригинала, а не работающая
 * дедупликация; у нас `context: instanceId` хотя бы записывается (в
 * отличие от оригинала), но найти его тоже неоткуда: `id` растёт монотонно
 * (`instanceSeq` в `chatStackStore`) и не повторяется, а других пушеров
 * `type: 'chat'` с тем же `context` нет. Ветка оставлена ради структурного
 * паритета с оригиналом (та же форма вызова `findItem`/`spliceItems`), не
 * потому что она живая хоть в одном из двух кодов.
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
    // РАСХОЖДЕНИЕ С ОРИГИНАЛОМ, НАЗВАННОЕ (находка ревью, Minor п.5а): здесь
    // снимается ТОЧНАЯ дельта (`chatRecordCount - wanted`), а у оригинала
    // цикл идёт `spliced.length - 1` раз (appImManager.ts:2690-2692). Это не
    // опечатка оригинала, а калибровка под ЕГО путь вызова: `spliceChats`
    // там — общий метод и для закрытия ЧЕРЕЗ запись (Back/`removeByType`
    // сняли ОДНУ запись раньше срока, значит спличить нужно на одну меньше),
    // и для схлопывания МИМО записи (наш эквивалент — `chatStackStore.setPeer`
    // «collapse to base», клик по другому чату из списка). У нас эти два пути
    // РАЗВЕДЕНЫ гардом `!closingViaRecord` — сюда мутация «уже сняла одну
    // запись сама» вообще не попадает (см. докблок `closingViaRecord`), и на
    // единственном оставшемся пути (мимо записи) точная дельта — это ВСЕ
    // лишние записи, ни одна заранее не снята. Наше поведение здесь
    // корректнее оригинала «в лоб», но это расхождение, а не совпадение,
    // и его стоит держать в уме при следующем касании этой функции.
    for (let i = wanted; i < chatRecordCount; i++) {
      appNavigationController.removeByType('chat', true)
    }
  }

  chatRecordCount = wanted

  // НАХОДКА РЕВЬЮ (Important): у `pushImRecordIfNeeded` есть пуш, но не было
  // симметричного снятия — единственным местом, где `im` покидала
  // `navigations[]`, был `back('im')`/`backByItem` (т.е. закрытие ЧЕРЕЗ
  // запись). Опустошение стека МИМО контроллера — `chatStackStore.clear()`
  // напрямую, не через `closeChatLevel` — оставляло запись висеть до
  // перезагрузки вкладки. Воспроизводимый путь: `useAuthGate.ts` на локальном
  // логауте (`onLoggingOut` без `migrateTo`) зовёт
  // `resetAccountStateInMemory()` → `useChatStackStore.getState().clear()`
  // напрямую, а `startChatHistory`/синглтон контроллера при этом не
  // размонтируются (в `App.tsx` пустые deps) — запись `im` переживает логаут,
  // и первый чат нового логина СВОЮ запись уже не получает (`findItemByType('im')`
  // находит чужую) — Back/Esc бьют не по тому, а несбалансированный `pushState`
  // никогда не гасится. `useUrlSync.ts` (`selectChat(null)` на пустом хэше)
  // — тот же `chatStackStore.clear()` изнутри `navigationStore.selectChat`,
  // чинится этим же кодом, отдельного пути нет.
  //
  // Гард `!closingViaRecord` здесь ТОТ ЖЕ, что и у `chat` выше и по той же
  // причине: если стек опустел потому, что `closeChatLevel` САМ вызвал
  // `selectChat(null)` (глубина была 1, Back/Esc закрыли `im`), запись УЖЕ
  // снята контроллером до этого вызова (`backByItem`: `spliceItems` до
  // `onPop`) — повторное снятие не нужно (`removeByType('im', true)` и без
  // гарда было бы безопасным no-op, но гард делает симметрию с `chat`
  // явной, а не полагается на no-op-безопасность как на документацию).
  if (!stack.length && !closingViaRecord) {
    appNavigationController.removeByType('im', true)
  }
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
