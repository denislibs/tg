// src/components/stackedAvatars.ts
//
// Стек наложенных друг на друга аватарок — порт tweb `src/components/
// stackedAvatars.ts` (класс `StackedAvatars`, :10-80).
//
// Разметка 1:1 с оригиналом (:5-8, :24-28, :45-70):
//   div.stacked-avatars[style="--avatar-size: Npx"]
//     └ div.stacked-avatars-avatar-container[.is-first][.is-last]
//         └ div.stacked-avatars-avatar            ← узел `avatarNew`
// Стили — `styles/tweb/_stackedAvatars.scss` (порт tweb
// `scss/partials/_stackedAvatars.scss`, байт в байт).
//
// Потребителей у оригинала много (чип реакции, футер комментариев, «кто
// просмотрел», бусты), у нас пока два — чип реакции (`chat/reactions.ts`) и
// футер комментариев (`chat/replies.ts`); поэтому модуль общий, как и в tweb, а
// не копия в каждом.
//
// ─── Отличия от оригинала и почему ──────────────────────────────────────────
//  • `lazyLoadQueue` (:12, :17, :57) не портирован: у нашего `avatarNew`
//    (`components/avatar.ts`) очереди загрузки нет вовсе — карточка пира
//    приезжает из зеркала (`core/peerCache.ts`), а не запросом на узел. Вторую
//    реализацию аватарки заводить нельзя, поэтому параметр не выдумываем.
//  • `StackedAvatarsTsx` (:82-101) — solid-js-обёртка того же класса; solid-js
//    в проекте нет (решение программы, см. `helpers/mediaSizes.ts`).
//  • `avatarContainer.middlewareHelper` в tweb — глобальное дополнение
//    `HTMLElement`; глобальных дополнений у нас нет (тот же вычет у
//    `wrappers/sticker.ts::StickerVideo`), поэтому тот же контракт выражен
//    локальным типом `AvatarContainer`.
import { avatarNew, type AvatarManagers } from '@components/avatar'
import type { Middleware, MiddlewareHelper } from '@helpers/middleware'

/** tweb stackedAvatars.ts:5-7. */
const CLASS_NAME = 'stacked-avatars'
const AVATAR_CLASS_NAME = CLASS_NAME + '-avatar'
const AVATAR_CONTAINER_CLASS_NAME = AVATAR_CLASS_NAME + '-container'

/** Оболочка одной аватарки: своя зона актуальности, чтобы перерисовка того же
 *  места гасила прошлое поколение (tweb :47-51). */
type AvatarContainer = HTMLElement & { middlewareHelper: MiddlewareHelper }

export default class StackedAvatars {
  public readonly container: HTMLElement
  private readonly avatarSize: number
  private readonly managers: AvatarManagers
  private readonly middlewareHelper: MiddlewareHelper

  constructor(options: {
    avatarSize: number
    middleware: Middleware
    managers: AvatarManagers
  }) {
    this.avatarSize = options.avatarSize
    this.managers = options.managers
    this.middlewareHelper = options.middleware.create()

    // tweb :25-29.
    this.container = document.createElement('div')
    this.container.classList.add(CLASS_NAME)
    this.container.style.setProperty('--avatar-size', options.avatarSize + 'px')
  }

  /**
   * MACOS, ANDROID - без реверса
   * WINDOWS DESKTOP - реверс
   * все приложения накладывают аватарку первую на вторую, а в макете зато вторая на первую, ЛОЛ!
   *
   * (комментарий оригинала, tweb :31-35 — он же объясняет `reverse()` ниже)
   *
   * Метод ИДЕМПОТЕНТЕН и переиспользует уже стоящие узлы (tweb :37-77): у
   * оригинала тот же стек переживает обновление счётчика реакций, поэтому
   * пересоздавать аватарки на каждый вызов нельзя — это перезагрузка картинки.
   */
  public render(peerIds: PeerId[], loadPromises: Promise<unknown>[] = []): Promise<unknown[]> {
    const children = this.container.children
    // tweb :38-42.
    peerIds = peerIds.slice().reverse()
    if (peerIds.length > 3) {
      peerIds = peerIds.slice(-3)
    }

    peerIds.forEach((peerId, idx) => {
      let avatarContainer = children[idx] as AvatarContainer | undefined
      if (!avatarContainer) {
        avatarContainer = document.createElement('div') as AvatarContainer
        avatarContainer.classList.add(AVATAR_CONTAINER_CLASS_NAME)
        avatarContainer.middlewareHelper = this.middlewareHelper.get().create()
      } else {
        avatarContainer.middlewareHelper.clean()
      }

      const avatarElem = avatarNew({
        middleware: avatarContainer.middlewareHelper.get(),
        size: this.avatarSize,
        managers: this.managers,
        peerId,
      })
      avatarElem.node.classList.add(AVATAR_CLASS_NAME)
      loadPromises.push(avatarElem.readyThumbPromise)

      avatarContainer.replaceChildren(avatarElem.node)

      if (!avatarContainer.parentNode) {
        this.container.append(avatarContainer)
      }

      // tweb :69-70 — края стека помечены, по ним CSS снимает наложение.
      avatarContainer.classList.toggle('is-first', idx === 0)
      avatarContainer.classList.toggle('is-last', idx === peerIds.length - 1)
    })

    // if were 3 and became 2 (tweb :73-76)
    ;(Array.from(children) as AvatarContainer[]).slice(peerIds.length).forEach((el) => {
      el.middlewareHelper.destroy()
      el.remove()
    })

    return Promise.all(loadPromises)
  }

  /** Снять весь стек вместе с его зоной актуальности. У оригинала этого метода
   *  нет: там стек умирает вместе с родительским `middleware` чипа
   *  (`reaction.ts:1067-1071` просто выбрасывает контейнер из DOM). У нас
   *  контейнер реакций пересобирается целиком на каждую правку сообщения
   *  (`chat/bubbles.ts::renderMessageMeta`), поэтому владельцу нужен явный вход
   *  — иначе зона аватарки прошлого поколения жила бы до смены чата. */
  public destroy(): void {
    this.middlewareHelper.destroy()
    this.container.remove()
  }
}
