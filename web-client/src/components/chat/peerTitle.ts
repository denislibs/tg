// src/components/chat/peerTitle.ts
//
// Порт tweb `src/components/peerTitle.ts` (класс `PeerTitle`) в применимом
// объёме: узел `<span class="peer-title" data-peer-id="…">` с именем пира,
// который сам себя перерисовывает, когда карточка пира изменилась.
//
// Этот узел — не украшение: именно его ловит делегированный слушатель ленты
// (`bubbles.ts::onContainerClick` → `.peer-title[data-peer-id]`, порт tweb
// bubbles.ts:3360-3364 `findUpClassName(target, 'peer-title')`), и именно
// `data-peer-id` несёт адресата клика.
//
// ОТКУДА ИМЯ. Синхронно из зеркала карточек пиров (`core/peerCache.ts`,
// владелец — воркерный `peersManager`) — как tweb берёт пира синхронно из
// `apiManagerProxy` внутри `getPeerTitle`. Промах зеркала = ПРОБЕЛ, который
// объявляет тот, кто его переживает (норма «владелец отвечает на объявленный
// пробел всегда», web-client/CLAUDE.md): здесь это сам узел —
// `managers.peers.fillMirror([peerId])`, а приехавшую карточку он подхватывает
// подпиской на зеркало.
//
// ─── Где мы расходимся с tweb (и почему) ───────────────────────────────────
//  • Перерисовка по изменению карточки. tweb ловит событие `peer_title_edit`
//    ОДНИМ модульным слушателем и находит живые узлы
//    `document.querySelectorAll('.peer-title[data-peer-id="…"]')`, доставая
//    инстанс из `WeakMap` (peerTitle.ts:36-46). Нам этот приём не подходит: узел
//    бабла существует ДО монтирования в документ (лента создаёт его в
//    `renderMessage`, а вставляет — серия), и скан документа его бы не нашёл.
//    Зато у нас есть `middleware` бабла, поэтому инстанс живёт в модульном
//    реестре и снимается оттуда по `middleware.onClean` — без утечки и без
//    скана всего документа.
//  • `options` в оригинале богаче (`dialog`, `onlyFirstName`, `limitSymbols`,
//    `withIcons`/`withPremiumIcon`, `threadId`, `asAllChats`, …) — у каждого из
//    них свой предмет (Saved Messages, топики форума, значки премиума/скам,
//    monoforum), которого у ленты на этом этапе нет. Оставлены ровно два:
//    `peerId` (обычный автор) и `fromName` (имя строкой, когда пира нет —
//    порт того же поля tweb: скрытый форвард, а у нас send-as, где заголовок
//    личности приезжает прямо в сообщении).
//  • Имя идёт через `wrapEmojiText` (`lib/richtext/wrapEmojiText.ts`) — как в
//    оригинале, где его прогоняет `getPeerTitle` (`wrappers/getPeerTitle.ts:91`,
//    `plainText` там не передаётся) и ветка `fromName` самого `PeerTitle`
//    (peerTitle.ts:114). Наш `getPeerTitle` собирает СТРОКУ, поэтому обёртка
//    живёт здесь — ровно как в `wrapEmojiText` оригинала, узлами.
import type { Middleware } from '@helpers/middleware'
import { cachedPeer, subscribePeerMirror } from '@core/peerCache'
import { getPeerTitle } from '@core/peers/getPeerTitle'
import { HIDDEN_PEER_ID } from '@core/peers/peerId'
import { wrapEmojiText } from '@lib/richtext'

/** Срез менеджеров, который нужен узлу имени: объявить пробел зеркала. */
export interface PeerTitleManagers {
  peers: { fillMirror(ids: number[]): Promise<void> }
}

export interface PeerTitleOptions {
  /** знаковый ключ пира; имя берётся из зеркала карточек */
  peerId?: PeerId
  /** готовое имя строкой — когда карточки пира нет и быть не может (send-as) */
  fromName?: string
  middleware: Middleware
  managers: PeerTitleManagers
}

// Живые узлы, ждущие движения зеркала. Аналог `weakMap` + модульного слушателя
// `peer_title_edit` в tweb (peerTitle.ts:34-46); подписка на зеркало одна на
// модуль, а не по одной на бабл.
const live = new Set<PeerTitle>()
subscribePeerMirror(() => {
  for (const title of live) {
    title.update()
  }
})

export default class PeerTitle {
  public readonly element: HTMLElement
  private readonly options: PeerTitleOptions
  /** пробел объявляем один раз на промах — повторный `update()` по чужой
   *  карточке не должен слать второй `fillMirror` за той же */
  private declaredGap = false

  constructor(options: PeerTitleOptions) {
    this.options = options

    const element = this.element = document.createElement('span')
    element.classList.add('peer-title')
    // tweb: `setDirection(this.element)` (peerTitle.ts:69) — имя может быть на
    // RTL-языке внутри LTR-бабла и наоборот.
    element.setAttribute('dir', 'auto')

    if (options.peerId !== undefined) {
      element.dataset.peerId = '' + options.peerId
    }

    this.update()

    // Имя строкой не может измениться — реестр ей не нужен.
    if (options.fromName === undefined && options.peerId !== undefined) {
      live.add(this)
      options.middleware.onClean(() => { live.delete(this) })
    }
  }

  /** Порт tweb `update` в применимом объёме (peerTitle.ts:104-200). */
  public update() {
    const { fromName, peerId, managers, middleware } = this.options
    if (!middleware()) {
      return
    }

    if (fromName !== undefined) {
      this.setTitle(fromName)
      return
    }

    if (peerId === undefined) {
      return
    }

    // Скрытая атрибуция пересылки (правило приватности `forwards`) — НЕ пир, а
    // sentinel-ключ: карточки для него не существует и появиться не может.
    // Порядок оригинала (peerTitle.ts:149) — эта ветка стоит ДО обращения к
    // хранилищу пиров; спросив зеркало, узел остался бы пустым навсегда и в
    // придачу без конца объявлял бы пробел за пиром, которого нет.
    if (peerId === HIDDEN_PEER_ID) {
      this.setTitle(getPeerTitle({ peerId, peer: undefined }))
      return
    }

    const peer = cachedPeer(peerId)
    if (!peer) {
      // Пробел зеркала объявляем ОДИН раз на промах: ответ владельца приедет
      // операцией rt:peer_op, и подписка выше перерисует узел.
      if (!this.declaredGap) {
        this.declaredGap = true
        managers.peers.fillMirror([peerId]).catch(() => { this.declaredGap = false })
      }
    }

    // Имя собирает клиент — `display_name` с провода убран (порт
    // `wrappers/getPeerTitle.ts`, у нас `core/peers/getPeerTitle.ts`).
    //
    // Карточки может не быть — и это НЕ повод оставить узел пустым: у
    // оригинала `!user` стоит первым термом того же фолбэка
    // (`getPeerTitle.ts:62`), то есть промах кэша и удалённый аккаунт дают одну
    // и ту же надпись. Иначе пир, которого владелец отдать не может (удалён,
    // недоступен), остался бы пустым узлом навсегда.
    this.setTitle(getPeerTitle({ peerId, peer }))
  }

  /** Порт `setInnerHTML(this.element, wrapEmojiText(title))` (peerTitle.ts:114,
   *  :228): имя — УЗЛЫ, а не строка. Сырой HTML тут невозможен по построению —
   *  `wrapEmojiText` собирает фрагмент из `createElement`/`createTextNode`. */
  private setTitle(title: string) {
    this.element.replaceChildren(wrapEmojiText(title))
  }
}
