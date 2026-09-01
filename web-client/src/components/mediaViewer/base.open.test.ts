// Тесты наполнения медиа `_openMedia` (порт tweb `mediaViewer/base.ts:2320-3005`
// в объёме фото), прелоадера, React-островов и полного `close()` (Task 13).
// Среда — happy-dom + fake timers: CSS-переходы не играют, полёт доводится
// страховочным таймером `waitForMoverTransition` (duration+100, tweb :1839);
// decode картинок стабится (happy-dom не декодирует), RPC managers и blur
// замоканы — тесты пинят ПОРЯДОК конвейера, не сеть/пиксели.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import mediaSizes from '@core/dom/mediaSizes'
import AppMediaViewerBase, {
  RESERVE_BOTTOM_DESKTOP, RESERVE_TOP_DESKTOP,
  type MoverElement, type ViewerAuthor, type ViewerMedia,
  type ViewerNavigation, type ViewerNavigationItem,
} from './base'
import ListLoader from './listLoader'
import { applyMediaUrl, resetMediaUrlMirror } from '@core/mediaCache'
import '../../test/lang'

const { downloadMediaURL } = vi.hoisted(() => ({ downloadMediaURL: vi.fn<(id: number) => Promise<string>>() }))

// RPC-мост вкладки: _openMedia ходит в воркер через startClient().managers —
// здесь фейк, реальный SharedWorker в happy-dom не поднять
vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL } } }),
}))

// blur грузит Image из data:-URI — в happy-dom onload не гарантирован; мок
// сохраняет контракт (канвас .canvas-thumbnail + promise готовности)
vi.mock('@helpers/blur', () => ({
  default: vi.fn(() => {
    const canvas = document.createElement('canvas')
    canvas.className = 'canvas-thumbnail'
    return { canvas, promise: Promise.resolve() }
  }),
}))

type Target = { element: HTMLElement }

/** 15 августа 2026, 12:34 — дата автора во всех тестах файла. Подпись под неё
 *  строит сам вьювер (`formatFullSentTime`), поэтому нужен ФИКСИРОВАННЫЙ год:
 *  иначе «August 15» превратилось бы в «August 15, 2026» при смене года. */
const SENT_AT = Math.floor(new Date('2026-08-15T12:34:00').getTime() / 1000)

// Публикатор protected-полей (штатный способ — сабкласс, как в base.test.ts).
class TestViewer extends AppMediaViewerBase<never, 'forward' | 'delete', Target> {
  public movedTheMover = 0
  public newMovers = 0

  get whole() { return this.wholeDiv }
  get contentMap() { return this.content }
  get authorMap() { return this.author }
  get preloaderPub() { return this.preloader }
  get rotationPub() { return this.rotation }
  set rotationPub(v: number) { this.rotation = v }
  get captionScrollablePub() { return this.captionScrollable }
  get navigationItemPub() { return this.navigationItem }
  get moverAnimationPub() { return this.setMoverAnimationPromise }

  callToggleGlobalListeners(active: boolean) { this.toggleGlobalListeners(active) }

  callOpenMedia(args: {
    media: ViewerMedia, author?: ViewerAuthor, fromRight: number, target?: HTMLElement,
    prevTargets?: Target[], nextTargets?: Target[],
  }) {
    return this._openMedia(args)
  }

  protected override moveTheMover(mover: MoverElement, toLeft?: boolean) {
    this.movedTheMover++
    return super.moveTheMover(mover, toLeft)
  }

  protected override setNewMover() {
    this.newMovers++
    return super.setNewMover()
  }
}

function makeViewer() {
  const listLoader = new ListLoader<Target, Target>({
    loadMore: async () => ({ count: 0, items: [] }),
  })
  return new TestViewer(listLoader, [])
}

const photo = (over: Partial<ViewerMedia> = {}): ViewerMedia => ({
  mediaId: 7,
  width: 800,
  height: 600,
  kind: 'photo',
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers()
  // happy-dom не умеет decode() — стаб: «декодировано мгновенно»
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: () => Promise.resolve(),
  })
  downloadMediaURL.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  resetMediaUrlMirror()
  document.body.replaceChildren()
})

// Полный доезд открытия: doubleRaf (2×rAF) + страховочный таймер open (200+100)
// + fastRaf-свапы.
async function settleOpen(p: Promise<void>) {
  await vi.advanceTimersByTimeAsync(600)
  await p
}

describe('_openMedia: сайзинг layout-ghost (tweb :2465 — общая setAttachmentSize)', () => {
  it('ghost получает px из setAttachmentSize(медиа → mediaBoxSize)', async () => {
    downloadMediaURL.mockResolvedValue('blob:full-size-test')
    const v = makeViewer()
    // happy-dom: окно 1024×768 → mediaBox = 1024 × (768 − 80 − 110) = 578;
    // 800×600 вписывается как 770×578 (целочисленный |0 из calcImageInBox)
    const p = v.callOpenMedia({ media: photo(), fromRight: 0 })
    expect(v.contentMap.media.style.width).toBe('770px')
    expect(v.contentMap.media.style.height).toBe('578px')
    await settleOpen(p)
  })

  it('меньше бокса при noZoom — натуральный размер, паддинги резервов на content', async () => {
    downloadMediaURL.mockResolvedValue('blob:full-size-test2')
    const v = makeViewer()
    const p = v.callOpenMedia({ media: photo({ width: 200, height: 100 }), fromRight: 0 })
    expect(v.contentMap.media.style.width).toBe('200px')
    expect(v.contentMap.media.style.height).toBe('100px')
    // applyLayoutPadding (tweb :2207-2213)
    expect(v.contentMap.main.style.paddingTop).toBe('80px')
    expect(v.contentMap.main.style.paddingBottom).toBe('110px')
    await settleOpen(p)
  })

  // Вьювер tweb зовёт ту же `setAttachmentSize`, что и баблы, и потому даром
  // получает её минимумы. Собственный расчёт (был `calcImageInBox` прямо здесь)
  // терял `MIN_SIDE_SIZE` — крошечная картинка открывалась крошечной.
  it('крошечное медиа растягивается покрытием до MIN_SIDE_SIZE (200)', async () => {
    downloadMediaURL.mockResolvedValue('blob:tiny')
    const v = makeViewer()
    const p = v.callOpenMedia({ media: photo({ width: 100, height: 80 }), fromRight: 0 })
    expect(v.contentMap.media.style.width).toBe('200px')
    expect(v.contentMap.media.style.height).toBe('160px')
    await settleOpen(p)
  })

  // ...но НЕ минимальную ширину (tweb :90 `&& message`): вьювер сообщения не
  // передаёт, и узкому кадру нельзя рвать пропорцию добивкой до 120/368.
  it('узкое медиа сохраняет пропорцию — минимальная ширина вне сообщения не применяется', async () => {
    downloadMediaURL.mockResolvedValue('blob:narrow')
    const v = makeViewer()
    const p = v.callOpenMedia({ media: photo({ width: 100, height: 900 }), fromRight: 0 })
    // 100×900 в бокс 1024×578 → 64×578; ни 120, ни 368 не вмешиваются
    expect(v.contentMap.media.style.width).toBe('64px')
    expect(v.contentMap.media.style.height).toBe('578px')
    await settleOpen(p)
  })
})

describe('_openMedia: thumb в ghost (tweb :2494-2528)', () => {
  it('закэшированный URL из зеркала → img.thumbnail сразу в контейнере', async () => {
    downloadMediaURL.mockResolvedValue('blob:cached-1')
    applyMediaUrl({ id: 7, thumb: false, url: 'blob:cached-1' })
    const v = makeViewer()
    const p = v.callOpenMedia({ media: photo(), fromRight: 0 })
    const img = v.contentMap.media.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.classList.contains('thumbnail')).toBe(true)
    expect(img!.src).toContain('blob:cached-1')
    await settleOpen(p)
  })

  it('нет URL, есть blurPreview → canvas-thumbnail (канвас-блюр)', async () => {
    downloadMediaURL.mockResolvedValue('blob:full-blur-test')
    const v = makeViewer()
    const p = v.callOpenMedia({ media: photo({ blurPreview: 'AAAA' }), fromRight: 0 })
    const canvas = v.contentMap.media.querySelector('canvas.canvas-thumbnail')
    expect(canvas).not.toBeNull()
    expect(canvas!.classList.contains('thumbnail')).toBe(true)
    await settleOpen(p)
  })
})

describe('_openMedia: полное медиа строго после onAnimationEnd (tweb :2921-2957)', () => {
  it('до конца полёта полного img в мувере нет; после — есть, старый thumb уходит кадром позже', async () => {
    // download резолвится сразу — единственный гейт свапа остаётся onAnimationEnd
    downloadMediaURL.mockResolvedValue('blob:full-7')
    const v = makeViewer()
    const p = v.callOpenMedia({ media: photo({ blurPreview: 'AAAA' }), fromRight: 0 })

    // set() ушёл после thumbPromise (микротаск) + doubleRaf; страховочный
    // таймер открытия (200+100) ещё НЕ дожат
    await vi.advanceTimersByTimeAsync(100)
    const mover = v.contentMap.mover
    expect(downloadMediaURL).toHaveBeenCalledWith(7)
    const fullBefore = [...mover.querySelectorAll('img')].filter((i) => i.src.includes('blob:full-7'))
    expect(fullBefore.length).toBe(0)

    // onAnimationEnd (страховочный таймер) + decode + первый fastRaf: полный
    // img встаёт. Шаг 10мс < кадра rAF (16мс): ловим состояние МЕЖДУ
    // fastRaf-свапом (append) и следующим кадром (remove старого thumb'а)
    let appeared = false
    for (let i = 0; i < 60 && !appeared; i++) {
      await vi.advanceTimersByTimeAsync(10)
      appeared = [...mover.querySelectorAll('img')].some((img) => img.src.includes('blob:full-7'))
    }
    expect(appeared).toBe(true)
    // старый thumb (канвас) ещё в DOM — уборка кадром ПОЗЖЕ (tweb :2949-2953)
    expect(mover.querySelector('.canvas-thumbnail')).not.toBeNull()

    // следующий кадр — старый thumb удалён
    await vi.advanceTimersByTimeAsync(40)
    expect(mover.querySelector('.canvas-thumbnail')).toBeNull()

    await settleOpen(p)
  })
})

describe('_openMedia: прелоадер (canAttachPreloader + attach/detach)', () => {
  it('attach на мувер (blank=true) при !downloaded, detach по приходу медиа', async () => {
    let resolveDownload!: (url: string) => void
    downloadMediaURL.mockReturnValue(new Promise<string>((res) => { resolveDownload = res }))
    const v = makeViewer()
    const attach = vi.spyOn(v.preloaderPub, 'attach')
    const detach = vi.spyOn(v.preloaderPub, 'detach')

    const p = v.callOpenMedia({ media: photo({ blurPreview: 'AAAA' }), fromRight: 0 })

    // до onAnimationEnd прелоадер не вешается
    await vi.advanceTimersByTimeAsync(100)
    expect(attach).not.toHaveBeenCalled()

    // onAnimationEnd, медиа ещё летит → attach(mover, true)
    await vi.advanceTimersByTimeAsync(300)
    expect(attach).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledWith(v.contentMap.mover, true)
    expect(detach).not.toHaveBeenCalled()

    resolveDownload('blob:late-7')
    await vi.advanceTimersByTimeAsync(100)
    expect(detach).toHaveBeenCalledTimes(1)

    await settleOpen(p)
  })

  it('маленькое медиа (<150×150) кольца не получает (порт photo.ts:297-301)', async () => {
    downloadMediaURL.mockReturnValue(new Promise<string>(() => {})) // вечная загрузка
    const v = makeViewer()
    const attach = vi.spyOn(v.preloaderPub, 'attach')
    const p = v.callOpenMedia({ media: photo({ width: 100, height: 100, blurPreview: 'AAAA' }), fromRight: 0 })
    await vi.advanceTimersByTimeAsync(600)
    expect(attach).not.toHaveBeenCalled()
    void p
  })

  it('ошибка загрузки → manual-ветка жива: attach + setManual, клик перезапускает load', async () => {
    downloadMediaURL.mockRejectedValueOnce(new Error('сеть упала'))
    downloadMediaURL.mockResolvedValue('blob:retry-7')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const v = makeViewer()
    const setManual = vi.spyOn(v.preloaderPub, 'setManual')

    const p = v.callOpenMedia({ media: photo({ blurPreview: 'AAAA' }), fromRight: 0 })
    await settleOpen(p)
    expect(setManual).toHaveBeenCalledTimes(1)
    expect(v.preloaderPub.preloader.classList.contains('manual')).toBe(true)

    // ретрай manual-кольца — через loadFunc (в tweb его зовёт onClick прелоадера)
    v.preloaderPub.loadFunc!()
    await vi.advanceTimersByTimeAsync(100)
    expect(downloadMediaURL).toHaveBeenCalledTimes(2)
    errSpy.mockRestore()
  })
})

describe('_openMedia: nav-путь (fromRight ≠ 0, tweb :2431-2436)', () => {
  it('листание зовёт moveTheMover + setNewMover и сбрасывает поворот', async () => {
    downloadMediaURL.mockResolvedValue('blob:nav-7')
    const v = makeViewer()
    const p1 = v.callOpenMedia({ media: photo({ blurPreview: 'AAAA' }), fromRight: 0 })
    await settleOpen(p1)
    expect(v.movedTheMover).toBe(0)
    const moversBefore = v.newMovers

    v.rotationPub = -90
    const p2 = v.callOpenMedia({ media: photo({ mediaId: 8, blurPreview: 'BBBB' }), fromRight: 1 })
    expect(v.movedTheMover).toBe(1)
    expect(v.newMovers).toBe(moversBefore + 1)
    expect(v.rotationPub).toBe(0) // resetRotationForNav (tweb :2420-2429)
    await vi.advanceTimersByTimeAsync(800)
    await p2
  })
})

describe('setAuthorInfo: React-остров аватарки (tweb :2017-2064)', () => {
  it('монтирует Avatar в .media-viewer-userpic, имя/дата — текстом', () => {
    const v = makeViewer()
    // Дата — СЕКУНДЫ эпохи: подпись строит сам вьювер узлом `formatFullSentTime`
    // (tweb :2043), готовой строки на входе больше нет.
    v.setAuthorInfo({ peerId: 1, name: 'Алиса', date: SENT_AT, avatarPreview: 'AAAA' })
    const userpics = v.whole.querySelectorAll('.media-viewer-userpic')
    expect(userpics.length).toBe(1)
    // без полной фотографии (src — Task 14) остров рисует инициал на peerColor
    expect(userpics[0].textContent).toBe('А')
    expect(v.authorMap.nameEl.textContent).toBe('Алиса')
    expect(v.authorMap.date.textContent).toBe('Aug 15 at 12:34')
  })

  it('повторный вызов не плодит второй root/хост — ре-рендер того же острова', () => {
    const v = makeViewer()
    v.setAuthorInfo({ peerId: 1, name: 'Алиса', date: SENT_AT })
    v.setAuthorInfo({ peerId: 2, name: 'Боб', date: SENT_AT })
    expect(v.whole.querySelectorAll('.media-viewer-userpic').length).toBe(1)
    expect(v.authorMap.container.querySelectorAll(':scope > div').length).toBe(2) // хост + author-right
    expect(v.authorMap.nameEl.textContent).toBe('Боб')
  })
})

describe('caption: контейнер и слот (tweb index.ts:112-141)', () => {
  it('caption — ПОСЛЕДНИЙ ребёнок wholeDiv (после movers), внутри scrollable', () => {
    const v = makeViewer()
    const last = v.whole.lastElementChild!
    expect(last.className).toBe('media-viewer-caption spoilers-container')
    expect(last.firstElementChild!.className).toBe('scrollable scrollable-y')
  })

  it('setCaptionNode кладёт узел в scrollable; null — чистит и прячет (hide)', () => {
    const v = makeViewer()
    const node = document.createElement('span')
    node.textContent = 'подпись'
    v.setCaptionNode(node)
    expect(v.captionScrollablePub.firstElementChild).toBe(node)
    expect(v.contentMap.caption.classList.contains('hide')).toBe(false)
    v.setCaptionNode(null)
    expect(v.captionScrollablePub.childElementCount).toBe(0)
    expect(v.contentMap.caption.classList.contains('hide')).toBe(true)
  })
})

describe('close(): полный порт (tweb :975-1024)', () => {
  it('полёт назад, wholeDiv удалён, острова unmount, onClose дёрнут', async () => {
    downloadMediaURL.mockResolvedValue('blob:close-7')
    const v = makeViewer()
    const onClose = vi.fn()
    v.onClose = onClose
    const p = v.callOpenMedia({
      media: photo({ blurPreview: 'AAAA' }),
      author: { peerId: 1, name: 'Алиса', date: SENT_AT },
      fromRight: 0,
    })
    await settleOpen(p)
    expect(document.body.contains(v.whole)).toBe(true)
    expect(v.whole.querySelectorAll('.media-viewer-userpic').length).toBe(1)

    const closePromise = v.close()
    expect(closePromise).not.toBeNull()
    await vi.advanceTimersByTimeAsync(600)
    await closePromise

    expect(document.body.contains(v.whole)).toBe(false)
    expect(v.whole.querySelectorAll('.media-viewer-userpic').length).toBe(0)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('повторный close() во время закрытия возвращает тот же промис', async () => {
    downloadMediaURL.mockResolvedValue('blob:close-8')
    const v = makeViewer()
    const p = v.callOpenMedia({ media: photo({ mediaId: 8, blurPreview: 'AAAA' }), fromRight: 0 })
    await settleOpen(p)

    const p1 = v.close()
    const p2 = v.close()
    expect(p2).toBe(p1)
    await vi.advanceTimersByTimeAsync(600)
    await p1
  })
})

// Адаптация Task 16: media.url — готовый источник байтов МИМО воркерного
// конвейера (секретные E2E-медиа, расшифрованные вкладкой; фото профиля).
describe('_openMedia: media.url минует downloadMediaURL (секретные E2E / фото профиля)', () => {
  it('строка url: downloadMediaURL НЕ зовётся, полный img встаёт из url', async () => {
    downloadMediaURL.mockResolvedValue('blob:should-not-be-used')
    const v = makeViewer()
    const p = v.callOpenMedia({ media: photo({ mediaId: 99, url: 'blob:secret-99' }), fromRight: 0 })
    await settleOpen(p)
    await vi.advanceTimersByTimeAsync(300)

    expect(downloadMediaURL).not.toHaveBeenCalled()
    const full = [...v.contentMap.mover.querySelectorAll('img')].filter((i) => i.src.includes('blob:secret-99'))
    expect(full.length).toBe(1)
  })

  it('ленивый url-резолвер (сосед листания, ещё не расшифрован): зовётся он, конвейер молчит', async () => {
    downloadMediaURL.mockResolvedValue('blob:should-not-be-used')
    const lazyUrl = vi.fn(async () => 'blob:secret-lazy')
    const v = makeViewer()
    const p = v.callOpenMedia({ media: photo({ mediaId: 98, url: lazyUrl }), fromRight: 0 })
    await settleOpen(p)
    await vi.advanceTimersByTimeAsync(300)

    expect(downloadMediaURL).not.toHaveBeenCalled()
    expect(lazyUrl).toHaveBeenCalledTimes(1)
    const full = [...v.contentMap.mover.querySelectorAll('img')].filter((i) => i.src.includes('blob:secret-lazy'))
    expect(full.length).toBe(1)
  })

  it('строка url — ещё и ghost-подложка (зеркало конвейера про эти байты не знает)', async () => {
    const v = makeViewer()
    const p = v.callOpenMedia({ media: photo({ mediaId: 97, url: 'blob:secret-ghost' }), fromRight: 0 })
    const img = v.contentMap.media.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.src).toContain('blob:secret-ghost')
    await settleOpen(p)
  })
})

// Проводка ресайза (tweb :1044,:1052 — `mediaSizes.addEventListener('resize')`,
// а не свой window-слушатель: экран и вьюпорт вьювер обязан читать из одного
// снимка). Без подписки паддинги лайтбокса остались бы от экрана открытия.
describe('глобальные слушатели: ресайз приезжает событием mediaSizes', () => {
  const wasMobile = mediaSizes.isMobile

  afterEach(() => {
    mediaSizes.isMobile = wasMobile
  })

  it('смена экрана пересчитывает резервы layout (tweb :2116-2122)', () => {
    const v = makeViewer()
    v.callToggleGlobalListeners(true)
    try {
      mediaSizes.isMobile = false
      mediaSizes.dispatchEvent('resize')
      expect(v.contentMap.main.style.paddingTop).toBe(`${RESERVE_TOP_DESKTOP}px`)
      expect(v.contentMap.main.style.paddingBottom).toBe(`${RESERVE_BOTTOM_DESKTOP}px`)

      // мобильный экран резервов не держит (топбар/подпись поверх медиа)
      mediaSizes.isMobile = true
      mediaSizes.dispatchEvent('resize')
      expect(v.contentMap.main.style.paddingTop).toBe('0px')
      expect(v.contentMap.main.style.paddingBottom).toBe('0px')
    } finally {
      v.callToggleGlobalListeners(false)
    }
  })
})

// Слой Esc/Back вьювера — порт tweb navigationItem (base.ts:2432-2447, :991-993).
// Механику стека вьюверу отдаёт контроллер; здесь она фейковая, проверяется
// сам вьювер: КОГДА он слой ставит, когда снимает и когда ОТКАЗЫВАЕТСЯ снимать.
describe('navigationItem: слой Esc/Back (tweb :2432-2447, :991-993)', () => {
  function withNavigation(v: TestViewer) {
    const pushItem = vi.fn<(item: ViewerNavigationItem) => void>()
    const removeItem = vi.fn<(item: ViewerNavigationItem) => void>()
    v.navigation = { pushItem, removeItem } satisfies ViewerNavigation
    return { pushItem, removeItem }
  }

  it('первое открытие ставит слой; листание соседей — не ставит второй', async () => {
    downloadMediaURL.mockResolvedValue('blob:nav-1')
    const v = makeViewer()
    const { pushItem } = withNavigation(v)

    await settleOpen(v.callOpenMedia({ media: photo(), fromRight: 0 }))
    expect(pushItem).toHaveBeenCalledTimes(1)
    expect(pushItem.mock.calls[0][0]).toBe(v.navigationItemPub)

    // fromRight !== 0 — ветка wasActive (tweb :2428-2431), слой уже стоит
    await settleOpen(v.callOpenMedia({ media: photo({ mediaId: 8 }), fromRight: 1 }))
    expect(pushItem).toHaveBeenCalledTimes(1)
  })

  it('ВЕТО: пока летит мувер, onPop не снимает слой и вьювер остаётся открытым', async () => {
    downloadMediaURL.mockResolvedValue('blob:nav-2')
    const v = makeViewer()
    const { removeItem } = withNavigation(v)

    const p = v.callOpenMedia({ media: photo({ blurPreview: 'AAAA' }), fromRight: 0 })
    // Середина полёта открытия (страховочный таймер 200+100 ещё не дожат) —
    // предусловие вето объявляем явно, чтобы проверка не стала холостой.
    await vi.advanceTimersByTimeAsync(100)
    expect(v.moverAnimationPub).not.toBeNull()

    const item = v.navigationItemPub!
    expect(item.onPop()).toBe(false)
    expect(removeItem).not.toHaveBeenCalled()
    expect(v.navigationItemPub).toBe(item) // слой на месте
    expect(v.whole.isConnected || v.whole.parentElement === null).toBe(true)

    await settleOpen(p)
    // Полёт кончился — тот же onPop уже закрывает, слой снимается
    expect(v.moverAnimationPub).toBeNull()
    item.onPop()
    expect(removeItem).toHaveBeenCalledWith(item)
    expect(v.navigationItemPub).toBeUndefined()
    await vi.advanceTimersByTimeAsync(600) // дожать полёт закрытия
  })

  it('close() снимает слой в начале закрытия (tweb :991-993)', async () => {
    downloadMediaURL.mockResolvedValue('blob:nav-3')
    const v = makeViewer()
    const { removeItem } = withNavigation(v)

    await settleOpen(v.callOpenMedia({ media: photo({ blurPreview: 'AAAA' }), fromRight: 0 }))
    const item = v.navigationItemPub!

    const closePromise = v.close()
    // Слой снят СРАЗУ, не по концу полёта закрытия.
    expect(removeItem).toHaveBeenCalledWith(item)
    expect(v.navigationItemPub).toBeUndefined()

    await vi.advanceTimersByTimeAsync(600)
    await closePromise
  })
})
