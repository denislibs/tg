// src/components/TopicsPanel.test.tsx
// Этап 4, Task 2: список тем форума переехал на то же виртуальное ядро, что и
// список папки с оверлеем архива (`DeferredSortedVirtualList`, порт tweb
// `forumTab/groupForumTab.ts:27-32` — `itemSize: 64, noAvatar: true`).
//
// Пины здесь про проводку ИМЕННО панели тем, а не про само ядро (оно покрыто
// `virtual/*.test.tsx`) и не про список чатов (`ChatList.test.tsx` /
// `Sidebar.archive.test.tsx`):
// (1) в DOM живут только строки окна, а не все темы;
// (2) `ul` лежит в контейнере прокрутки и несёт высоту под ВЕСЬ набор видимых
//     тем — `itemSize` 64 и `extraPaddingBottom` 0;
// (3) `noAvatar` доезжает до ядра (у темы аватара нет);
// (4) пока темы не приехали, `ul` ростом с хост (`wasAtLeastOnceFetched`);
// (5) секция скрытых тем по-прежнему В ПОТОКЕ под `ul` и раскрывается;
// (6) поиск по темам фильтрует набор;
// (7) `TopicRow` — `memo`-компонент со стабильными пропсами: ни кадр скролла, ни
//     рендер панели, ни правка одной темы не перерисовывают остальные строки.
//
// Рендерится НАСТОЯЩАЯ панель с настоящим ядром: подменены только RPC-менеджеры
// (источник тем) — счётчик рендеров строк снимается с реального `fmtWhen`,
// который строка зовёт ровно один раз за рендер и ровно со своим `lastAt`
// (приём `Sidebar.archive.test.tsx` с `useTypingLabel`).
//
// happy-dom не считает layout: `offsetHeight`/`offsetWidth` (их читает
// `useElementSize` у контейнера прокрутки) подставляются стабом на прототипе.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'

// `rowRenders` — `lastAt` каждого рендера НАСТОЯЩЕЙ строки темы (у каждой темы
// он свой). `listProps` — пропсы, приехавшие в ядро списка: так проверяются
// `noAvatar`/`itemSize` (скелетонов у непагинируемого списка не бывает вовсе,
// поэтому через DOM их не увидеть) и стабильность ссылки `renderItem`.
const { rowRenders, listProps } = vi.hoisted(() => ({
  rowRenders: [] as string[],
  listProps: [] as Record<string, unknown>[],
}))

vi.mock('../core/dialogToChat', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../core/dialogToChat')>()
  return {
    ...mod,
    fmtWhen: (iso?: string) => {
      rowRenders.push(iso ?? '')
      return mod.fmtWhen(iso)
    },
  }
})

vi.mock('./virtual/DeferredSortedVirtualList', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./virtual/DeferredSortedVirtualList')>()
  const Real = mod.default
  return {
    ...mod,
    default: (props: ComponentProps<typeof Real>) => {
      listProps.push(props as unknown as Record<string, unknown>)
      return <Real {...props} />
    },
  }
})

import type { ComponentProps } from 'react'

import TopicsPanel from './TopicsPanel'
import s from './TopicsPanel.module.scss'
import { ManagersProvider } from '../core/hooks/useManagers'
import type { Managers } from '../client/bootstrap'
import type { TopicRow as Topic } from '../core/managers/groupsManager'

const HOST_HEIGHT = 720
const ITEM = 64
const CHAT_ID = -42 // ключ чата ЗНАКОВЫЙ: у группы он отрицательный
/** Тем заведомо больше окна. */
const TOPICS = 200

/** У каждой темы свой `lastAt` — по нему считаются рендеры её строки. */
const whenOf = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 1000).toISOString()

const topic = (i: number, over: Partial<Topic> = {}): Topic => ({
  id: i,
  peerId: CHAT_ID,
  rootMsgId: 1000 + i,
  title: 'topic-' + i,
  iconColor: 0,
  iconEmoji: '',
  closed: false,
  hidden: false,
  pinned: false,
  pos: i,
  isGeneral: false,
  createdBy: 1,
  msgCount: 0,
  lastText: 'text-' + i,
  lastType: '',
  lastSenderName: '',
  lastAt: whenOf(i),
  unread: 0,
  unreadMentions: 0,
  muted: false,
  lastOut: false,
  lastMsgSeq: 0,
  ...over,
})

const manyTopics = (n = TOPICS) => Array.from({ length: n }, (_, i) => topic(i))

function fakeManagers(topics: Topic[] | Promise<Topic[]>) {
  const listTopics = vi.fn(async () => await topics)
  const readTopic = vi.fn(async () => undefined)
  const managers = new Proxy({}, {
    get: (_target, ns: string) => new Proxy({}, {
      get: (_t, method: string) => {
        if (ns === 'groups' && method === 'listTopics') return listTopics
        if (ns === 'groups' && method === 'readTopic') return readTopic
        if (ns === 'groups' && method === 'card') return async () => ({ myRole: 'member', myRights: 0 })
        return async () => undefined
      },
    }),
  }) as unknown as Managers
  return { managers, listTopics, readTopic }
}

/** Контейнер прокрутки панели — он же `scrollableHost` списка. */
const host = () => document.querySelector<HTMLElement>('.' + s.list) as HTMLElement
const list = () => host().querySelector('ul') as HTMLElement
const rows = () => Array.from(list().querySelectorAll<HTMLElement>('.' + s.row))
const titles = () => rows().map((row) => row.textContent ?? '')
/** Сколько раз рендерилась строка темы `i`. */
const renders = (i: number) => rowRenders.filter((at) => at === whenOf(i)).length
/** Последние пропсы, приехавшие в ядро списка (`Array.prototype.at` — вне нашей lib). */
const last = (props: Record<string, unknown>[]) => props[props.length - 1]

async function renderPanel(topics: Topic[] | Promise<Topic[]> = manyTopics()) {
  const { managers, listTopics, readTopic } = fakeManagers(topics)
  const onOpenTopic = vi.fn()
  const panel = (activeRootMsgId: number | null) => (
    <ManagersProvider managers={managers}>
      <TopicsPanel
        chatId={CHAT_ID}
        chatName="Forum"
        activeRootMsgId={activeRootMsgId}
        onClose={() => {}}
        onOpenTopic={onOpenTopic}
        onViewAsMessages={() => {}}
      />
    </ManagersProvider>
  )
  const { rerender } = render(panel(null))
  await act(async () => {})
  /** Открыть тему в колонке чата — панели это приезжает пропом. */
  const setActive = async (activeRootMsgId: number | null) => {
    await act(async () => { rerender(panel(activeRootMsgId)) })
  }
  return { listTopics, readTopic, onOpenTopic, setActive }
}

/** Троттлинг измерения скролла в happy-dom уходит в `setTimeout(24)`. */
async function scrollTo(top: number) {
  const el = host()
  act(() => {
    el.scrollTop = top
    el.dispatchEvent(new Event('scroll'))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
}

let sizeStubbed = false

beforeEach(() => {
  rowRenders.length = 0
  listProps.length = 0

  if (!sizeStubbed) {
    sizeStubbed = true
    const isHost = (el: HTMLElement) => el.classList.contains(s.list)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) { return isHost(this) ? HOST_HEIGHT : 0 },
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) { return isHost(this) ? 360 : 0 },
    })
  }
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('TopicsPanel — темы форума на виртуальном ядре', () => {
  it('200 тем: в DOM только строки окна (15 = 720/64 + overscan 4)', async () => {
    await renderPanel()

    // idx * 64 >= 0 - 288 — верно для всех idx >= 0;
    // (idx + 1) * 64 <= 0 + 720 + 288 = 1008 → idx <= 14.
    expect(rows()).toHaveLength(15)
    expect(titles()[0]).toContain('topic-0')
    expect(titles()[14]).toContain('topic-14')
  })

  it('скролл двигает окно: въезжают следующие строки, уехавшие уходят', async () => {
    await renderPanel()

    await scrollTo(HOST_HEIGHT)

    // Нижняя: idx * 64 >= 720 - 288 = 432 → idx >= 7 (ceil 6.75);
    // верхняя: (idx + 1) * 64 <= 720 + 720 + 288 = 1728 → idx <= 26.
    expect(rows()).toHaveLength(20)
    expect(titles()[0]).toContain('topic-7')
    expect(titles()[19]).toContain('topic-26')
  })

  it('ul лежит в контейнере прокрутки и несёт высоту под ВСЕ темы (200 * 64, без +8)', async () => {
    await renderPanel()

    expect(list().parentElement).toBe(host())
    // `extraPaddingBottom: 0` — нижний клиренс уже даёт `padding-bottom` самого
    // контейнера прокрутки, а под `ul` в потоке идёт секция скрытых тем.
    expect(list().style.height).toBe(TOPICS * ITEM + 'px')
  })

  it('ядро получает noAvatar (у темы нет аватара) и itemSize 64', async () => {
    await renderPanel()

    // Скелетоны видны только на «дырках» — их у непагинируемого списка не
    // бывает, поэтому `noAvatar` наблюдаем только на границе с ядром.
    // Мутация: убрать `noAvatar` / поставить `itemSize={72}` — красное.
    expect(last(listProps).noAvatar).toBe(true)
    expect(last(listProps).itemSize).toBe(ITEM)
    // Класс `ul` — вторая половина пина геометрии: под ним лежит
    // `position: relative` (см. describe «геометрия строки»), без которого
    // абсолютные строки отсчитывались бы от панели, а не от списка. В happy-dom
    // нет layout, поэтому проверяются обе половины по отдельности.
    expect(last(listProps).className).toBe(s.virtualList)
  })

  it('пока темы не приехали, ul ростом с хост (wasAtLeastOnceFetched)', async () => {
    let resolveTopics: (t: Topic[]) => void = () => {}
    const pending = new Promise<Topic[]>((resolve) => { resolveTopics = resolve })

    await renderPanel(pending)

    // Мутация: `wasAtLeastOnceFetched` константой `true` — `ul` схлопнется в 0.
    expect(list().style.height).toBe(HOST_HEIGHT + 'px')
    expect(rows()).toHaveLength(0)

    await act(async () => { resolveTopics(manyTopics(3)) })

    expect(list().style.height).toBe(3 * ITEM + 'px')
    expect(rows()).toHaveLength(3)
  })

  it('секция скрытых тем осталась В ПОТОКЕ под ul и раскрывается кликом', async () => {
    await renderPanel([...manyTopics(3), topic(90, { hidden: true }), topic(91, { hidden: true })])

    // Скрытые темы в виртуальный список не попадают (см. комментарий в
    // `TopicsPanel.tsx`: ядро умеет только однородные строки).
    expect(rows()).toHaveLength(3)
    expect(list().style.height).toBe(3 * ITEM + 'px')
    expect(document.querySelectorAll('.' + s.rowDimmed)).toHaveLength(0)

    await act(async () => { fireEvent.click(document.querySelector('.' + s.hiddenHeader) as HTMLElement) })

    const dimmed = Array.from(document.querySelectorAll<HTMLElement>('.' + s.rowDimmed))
    expect(dimmed).toHaveLength(2)
    // Именно в потоке: скрытые строки лежат вне `ul` виртуального списка.
    expect(dimmed.every((row) => row.closest('ul') === null)).toBe(true)
    expect(rows()).toHaveLength(3)
  })

  it('поиск по темам фильтрует окно и высоту списка', async () => {
    await renderPanel()

    await act(async () => { fireEvent.click(screen.getByLabelText('Search')) })
    await act(async () => {
      fireEvent.change(document.querySelector('.' + s.searchInput) as HTMLInputElement, {
        target: { value: 'topic-199' },
      })
    })

    expect(rows()).toHaveLength(1)
    expect(titles()[0]).toContain('topic-199')
    expect(list().style.height).toBe(ITEM + 'px')
  })

  it('клик по теме открывает её тред', async () => {
    const { onOpenTopic } = await renderPanel()

    await act(async () => { fireEvent.click(rows()[3]) })

    expect(onOpenTopic).toHaveBeenCalledTimes(1)
    expect(onOpenTopic.mock.calls[0][0]).toMatchObject({ id: 3, title: 'topic-3' })
  })

  it('скролл не перерисовывает строки, оставшиеся в окне', async () => {
    await renderPanel()
    expect(renders(10)).toBe(1)

    await scrollTo(HOST_HEIGHT)

    // Строка 10 осталась в окне (7..26) — её `memo` обязан её удержать.
    // Мутации: снять `memo` с `TopicRow`, снять `useCallback` вокруг
    // `renderItem` — строка перерисуется на кадре скролла.
    expect(renders(10)).toBe(1)
    expect(renders(20)).toBe(1) // въехавшая — ровно один рендер
  })

  it('смена активной темы перерисовывает только затронутые строки', async () => {
    const { setActive } = await renderPanel()
    expect(renders(0)).toBe(1)

    // Активная тема — единственное, от чего зависит `renderItem`: он приезжает
    // в ядро новой ссылкой, и ядро прогоняет ВСЁ окно заново. Дальше строки
    // держит их собственный `memo` — перерисовывается только та, у которой
    // реально сменился `active`. Мутация: снять `memo` с `TopicRow` — все 15
    // строк окна перерисуются (у ядра `memo` на этом рендере уже не спасает).
    await setActive(1005)

    expect(renders(5)).toBe(2)
    expect(renders(0)).toBe(1)
    expect(rows()[5].className).toContain(s.rowActive)
  })

  it('рендер панели (открытие меню) строк не касается', async () => {
    await renderPanel()
    expect(renders(0)).toBe(1)

    // Состояние панели, к темам отношения не имеющее. Мутации, которые это
    // краснит: снять `useEvent` вокруг `handleOpenTopic`/`openRowMenu` или
    // `useCallback` вокруг `renderItem` — все строки окна перерисуются.
    await act(async () => { fireEvent.click(screen.getByLabelText('Menu')) })

    expect(renders(0)).toBe(1)
    expect(rowRenders).toHaveLength(15)
  })

  it('ядро получает ОДНУ И ТУ ЖЕ ссылку renderItem между рендерами', async () => {
    await renderPanel()
    await act(async () => { fireEvent.click(screen.getByLabelText('Menu')) })

    expect(listProps.length).toBeGreaterThan(1)
    expect(new Set(listProps.map((p) => p.renderItem)).size).toBe(1)
  })

  it('отсев тем НАД окном компенсируется скроллом, а не рывком всех строк', async () => {
    // Первые 5 тем поиск отсеет, остальные 195 останутся — все видимые строки
    // уезжают ровно на 5 позиций.
    const head = Array.from({ length: 5 }, (_, i) => topic(i, { title: 'other-' + i }))
    await renderPanel([...head, ...manyTopics().slice(5)])
    await scrollTo(HOST_HEIGHT)

    await act(async () => { fireEvent.click(screen.getByLabelText('Search')) })
    await act(async () => {
      fireEvent.change(document.querySelector('.' + s.searchInput) as HTMLInputElement, {
        target: { value: 'topic-' },
      })
    })

    // Равномерный сдвиг ядро компенсирует скроллом, а не анимацией `top` у всех
    // видимых строк сразу (`useShouldAnimate` → `createScrollShiftCompensator`).
    // Мутация: убрать кэш обёрток (`itemCacheRef`) — сравнение старого и нового
    // списка идёт ПО ССЫЛКЕ, новые обёртки в прежнем списке не найдутся,
    // компенсация не сработает и весь экран дёрнется.
    expect(host().scrollTop).toBe(HOST_HEIGHT - 5 * ITEM)
  })

  it('пометка одной темы прочитанной не перерисовывает остальные строки', async () => {
    await renderPanel([...manyTopics(2), topic(2, { unread: 5 }), ...manyTopics().slice(3)])
    expect(renders(0)).toBe(1)
    expect(renders(2)).toBe(1)

    // Клик по непрочитанной теме обнуляет её счётчик — в состоянии панели новым
    // объектом приезжает ТОЛЬКО она, остальные сохраняют ссылку и их держит
    // `memo` строки. Мутация: пересобрать в `handleOpenTopic` весь набор
    // (`map((tp) => ({ ...tp }))`) — перерисуются все 15 строк окна.
    await act(async () => { fireEvent.click(rows()[2]) })

    expect(renders(2)).toBe(2)
    expect(renders(0)).toBe(1)
    expect(renders(14)).toBe(1)
  })

  it('пустое состояние: заглушка вместо строк', async () => {
    await renderPanel([])

    expect(rows()).toHaveLength(0)
    expect(screen.getByText('No topics')).toBeTruthy()
  })
})

// Высота строки — часть проводки: ядро кладёт строки абсолютом с шагом
// `itemSize`, и расхождение стиля с 64px даёт либо щели, либо наложение строк.
// В happy-dom нет layout, но каскад объявленных свойств работает — поэтому
// правило берётся из НАСТОЯЩЕГО скомпилированного `TopicsPanel.module.scss`
// (приём `styles/mediaLayering.test.ts`). Имена классов здесь — исходные
// (хеширование делает Vite, а не sass), поэтому узел строится вручную.
describe('TopicsPanel — геометрия строки', () => {
  let css: string

  beforeAll(() => {
    // Вместе с глобальным листом: 64px — это высота ВМЕСТЕ с padding, а
    // `box-sizing: border-box` приходит из `styles/index.scss` (правило `*`).
    // Без него строка была бы 76px и разъехалась бы с шагом ядра.
    const global = sass.compile(join(__dirname, '..', 'styles', 'index.scss'), {
      loadPaths: [join(__dirname, '..', 'styles'), join(__dirname, '..', '..', 'node_modules')],
      silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
      quietDeps: true,
    }).css
    css = global + '\n' + sass.compile(join(__dirname, 'TopicsPanel.module.scss')).css
  })

  it('строка ровно 64px — столько же, сколько itemSize ядра', () => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)

    const ul = document.createElement('ul')
    ul.className = 'virtualList'
    document.body.append(ul)

    const row = document.createElement('div')
    row.className = 'row'
    document.body.append(row)

    // Абсолютные строки обязаны отсчитываться от самого `ul`, а не от панели.
    // Мутация: убрать `position: relative` у `.virtualList` — красное.
    expect(getComputedStyle(ul).position).toBe('relative')

    // Мутация: вернуть `min-height` вместо `height` — абсолютная строка
    // перестаёт гарантировать шаг 64 (её высоту начинает диктовать содержимое).
    expect(getComputedStyle(row).height).toBe('64px')
    expect(getComputedStyle(row).boxSizing).toBe('border-box')

    style.remove()
    row.remove()
    ul.remove()
  })
})
