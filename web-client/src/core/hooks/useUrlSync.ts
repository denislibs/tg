// Синхронизация URL-хэша с открытым чатом: направление «хэш → стор» (Phase A
// роутинга, в духе tweb Web K: #@username / #<peerId>). На загрузке и popstate
// читает хэш и открывает чат (без восстановления ветки треда — для неё нужны
// метаданные топика).
//
// Направление «стор → хэш» отсюда уехало в `core/navigation/chatHistory.ts`
// (`startChatHistory`): та сторона пишет хэш НА МЕСТЕ через
// `appNavigationController.overrideHash`, а не собственным `history.pushState`
// — смена чата не создаёт запись истории, как в оригинале (снятие ОСТАТКА
// #108, см. докблок `chatHistory.ts`).
//
// Phase A охватывает слой ЧАТА (шаринг ссылки, восстановление после reload).
// Оверлеи (попапы/панели/поиск) через Back — это Phase B (navigationController).
//
// ── ПЕРВОЕ применение хэша здесь БОЛЬШЕ НЕ ЖИВЁТ ─────────────────────────────
// В оригинале это два РАЗНЫХ действия и стоят они в разных местах:
// подписка — `appNavigationController.onHashChange = this.onHashChange`
// (tweb `appImManager.ts:317-318`), а первое применение — отдельный вызов
// `this.onHashChange(true)` (tweb `appImManager.ts:834`), и он стоит ДО
// загрузки списка диалогов (`appDialogsManager.ts:726` — `onStateLoaded`).
// У нас первое применение уехало в `client/boot.ts` ровно за этим: пока оно
// висело на эффекте смонтированного React (`App.tsx` → `useEffect` ниже), путь
// «открыть по ссылке» был заперт за ответом воркера про диалоги
// (`boot.ts::await dialogsOp`) и за полным маунтом дерева.
import { useEffect } from 'react'
import { useManagers } from './useManagers'
import { useNavigationStore } from '../../stores/navigationStore'
import appNavigationController from '../navigation/appNavigationController'
import { parseNavHash, requestMessageJump } from '../messageLink'
import { getPeerPhotoId, peerKey } from '../peers/peer'
import { getUserTitle } from '../peers/getPeerTitle'
import { toastNew } from '../../components/toast'
import type { Managers } from '../../client/bootstrap'

/**
 * Порт `openUsername` (tweb `appImManager.ts:1796-1810`): ОДИН резолв имени,
 * успех → открыть пира, отказ → сказать об этом пользователю.
 *
 * Отказ раньше глушился пустым `catch {}`, и это был единственный путь, на
 * котором «шапка есть, ленты нет» становилось ПОСТОЯННЫМ состоянием: список
 * чатов оставался на экране без единого слова о том, что имя не открылось.
 * Две первые ветки — дословно оригинала (`USERNAME_NOT_OCCUPIED` →
 * `NoUsernameFound`, `USERNAME_INVALID` → `Alert.UserDoesntExists`,
 * tweb :1802-1808); имя отказа приезжает через границу воркера полем
 * `errorType` (`rpc/superMessagePort.ts:239-252`).
 *
 * ТРЕТЬЯ ветка — наша, и она обязательна. У оригинала на «сеть отказала»
 * молчание не значит молчания: под транспортом MTProto висит собственный
 * индикатор состояния соединения (`ConnectionStatusComponent`, tweb
 * `appDialogsManager.ts:719`), который сам объясняет пользователю, что
 * происходит, а сам вызов пере-отправится (`networker.resend()`,
 * `mtproto/networker.ts:1701-1716`). Под нашим REST нет ни того, ни другого —
 * промолчать здесь и значит вернуть тот самый глухой перехват, только под
 * другим `if`. Текст поэтому НЕ врёт про «имя не занято»: отказ сети — не
 * ответ директории.
 */
function toastUsernameError(err: unknown): void {
  const type = (err as { type?: string } | null)?.type
  if (type === 'USERNAME_NOT_OCCUPIED') toastNew({ langPackKey: 'NoUsernameFound' })
  else if (type === 'USERNAME_INVALID') toastNew({ langPackKey: 'Alert.UserDoesntExists' })
  else toastNew({ langPackKey: 'Error.SomethingWentWrong' })
}

// Применить хэш к навигации. Публичный @username резолвит владелец карточек
// пиров (`managers.peers.resolveUsername`) — по индексу имён, с одним запросом
// на промахе; чат → вступить+открыть, юзер → черновик.
export async function applyHash(rawHash: string, managers: Managers): Promise<void> {
  const nav = useNavigationStore.getState()
  if (!rawHash.replace(/^#/, '')) { nav.selectChat(null); return }

  const parsed = parseNavHash(rawHash)
  if (!parsed) return

  // Прыжок к сообщению ставится ДО открытия чата: лента потребляет pendingJump
  // при монтировании (тот же путь, что переход из поиска).
  const openAt = (peerId: PeerId | string) => {
    if (parsed.seq != null) requestMessageJump(Number(peerId), parsed.seq)
    nav.selectChat(String(peerId))
  }

  if (parsed.target.startsWith('@')) {
    let peer
    try {
      // Порт tweb :1800 — ОДИН вызов резолва вместо прежней тройки
      // «`channels.search` → `join` → `dialogs.refresh`»: индекс имён владельца
      // отвечает без сети, промах стоит один запрос (см. докблок
      // `peersManager.resolveUsername`).
      peer = await managers.peers.resolveUsername(parsed.target)
    } catch (err) {
      toastUsernameError(err)
      return
    }

    if (peer._ === 'user') {
      // selectChat кладёт черновик-инстанс в chatStackStore (см. openPeer в
      // useNavigationActions — та же пара вызовов и тот же порядок: draftPeer
      // восстанавливается ПОСЛЕ selectChat, которая сама его обнуляет).
      nav.selectChat(`draft:${peer.id}`)
      nav.setDraftPeer({ id: peerKey(peer), title: getUserTitle(peer), username: peer.username, photoId: getPeerPhotoId(peer.photo) || undefined })
      return
    }

    // Ключ чата ЗНАКОВЫЙ (`-id`), а `chat.id` внутри конструктора —
    // положительный сырой идентификатор: переход между ними только через
    // `peerKey`.
    const peerId = peerKey(peer)

    // ОТСТУПЛЕНИЕ ОТ ОРИГИНАЛА, вынужденное бэкендом. tweb по ссылке в канал не
    // вступает: `op()` → `setInnerPeer` открывает превью, а кнопку JOIN рисует
    // сам чат по `channel.pFlags.left`. Наш `GET /chats/{id}/history`
    // не-участнику отдаёт 403 (`chat_handler.go:499-502`), а поиск отдаёт
    // карточку с `ViewerID == 0`, то есть `left` в ней всегда ложен
    // (`domain/chat.go:380`) — членство из карточки не выводится вовсе.
    // Поэтому спрашиваем ВЛАДЕЛЬЦА диалогов (`hasDialog`, порт
    // `appMessagesManager.getDialogOnly`, tweb :4363-4365) и вступаем ТОЛЬКО
    // если строки диалога нет. Долг «превью публичного канала без вступления» —
    // `docs/readiness/port-divergences.md`.
    if ('username' in peer && peer.username && !(await managers.dialogs.hasDialog(peerId))) {
      try { await managers.channels.join(peer.username) } catch { /* приватный / уже вступил */ }
      // Список догоняет ПОСЛЕ открытия и НЕ ждётся: у оригинала открытие пира
      // тоже не ждёт чатлиста (tweb `appImManager.ts:834` против
      // `appDialogsManager.ts:726`). `.catch` обязателен — `refresh()`
      // пробрасывает 401/5xx, и fire-and-forget без него даёт unhandled
      // rejection (пин `core/managers/dialogsRefreshCatch.test.ts`).
      void managers.dialogs.refresh().catch(() => { /* список догонит следующий refresh */ })
    }

    openAt(peerId)
    return
  }

  // #<peerId>, #<peerId>_<threadRoot> (ветку в Phase A не восстанавливаем)
  // или #<peerId>/<seq> — открываем чат, при наличии якоря прыгаем к сообщению.
  openAt(parsed.target)
}

/**
 * ПЕРВОЕ применение хэша — ровно один раз за жизнь страницы, как
 * `this.onHashChange(true)` внутри `appImManager.construct` (tweb
 * `appImManager.ts:834`): у оригинала IM конструируется однажды, из
 * `bootstrapIm()` (tweb `pages/bootstrapIm.ts:39-48`), и второй раз этот вызов
 * не случается ни при каких переходах.
 *
 * Два входа, потому что у нас две точки, где «IM поднимается»:
 *  • `client/boot.ts` — страница загрузилась С ТОКЕНОМ: там применение стоит ДО
 *    загрузки списка диалогов, ради чего вся правка и делалась;
 *  • монтирование `Shell` (`useUrlSync` ниже) — страница загрузилась БЕЗ
 *    токена, и IM поднимается только после входа (`useAuthGate.login()`
 *    перезагрузки не делает). У оригинала это ровно тот же случай: `bootstrapIm()`
 *    зовётся и после авторизации (tweb `index.ts:628` против `:641`).
 *
 * Защёлка одна на оба входа: второй вызов не должен ни резолвить имя заново, ни
 * вступать в канал повторно. Логаут её НЕ снимает намеренно — хэш в адресной
 * строке принадлежит прошлому аккаунту, и открывать по нему чат следующего
 * значило бы вести пользователя в чужой чат.
 */
let hashBootstrapped = false

export function bootstrapHash(managers: Managers): void {
  if (hashBootstrapped) return
  hashBootstrapped = true
  void applyHash(location.hash, managers)
}

/** Сброс защёлки для тестов — та же роль, что у `resetPeerMirror`/
 *  `resetStateCache`: модульное состояние не должно течь между прогонами. */
export function resetHashBootstrap(): void {
  hashBootstrapped = false
}

export function useUrlSync(): void {
  const managers = useManagers()
  // Подписка: смена хэша, дошедшая до контроллера навигации (он единственный
  // владелец popstate). `onHashChange` — ручка самого оригинала
  // (`appNavigationController.ts:41`, `appImManager.ts:317-318` ставит туда
  // свой обработчик): контроллер зовёт её, когда пришедший popstate поменял
  // ХЭШ, а не снял запись навигации.
  //
  // Первичное применение — через защёлку выше: на холодном старте с токеном
  // его уже сделал `client/boot.ts`, здесь останется только подписка.
  useEffect(() => {
    bootstrapHash(managers)
    appNavigationController.onHashChange = () => { void applyHash(location.hash, managers) }
  }, [managers])
}
