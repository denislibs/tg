// TabSlide — порт tweb TransitionSlider типа 'tabs' (`components/transition.ts:44-93`
// slideTabs + `components/transition.ts:300-323` selectTab) на React.
//
// Механизм tweb 1:1, без JS-анимирования:
//   • контейнер — `.tabs-container[data-animation="tabs"]` (_slider.scss:164-216):
//     CSS-grid, все табы лежат в одной ячейке; `.tabs-tab` скрыт (display: none),
//     показывается классом `.active`; переход — `transform var(--tabs-transition)`;
//   • на переключении оба кадра ЖИВУТ в DOM: уходящему и приходящему выставляются
//     инлайновые transform ∓width, делается reflow, после чего у приходящего
//     transform снимается — он въезжает к 0, а уходящий уезжает наружу;
//   • направление: `toRight = prevId < id` (индекс в `order`), контейнер получает
//     `animating`, а при !toRight ещё и `backwards` (transition.ts:305-307);
//   • уходящий кадр снимается по transitionend, фолбэк-таймер `transitionTime + 100`
//     (transition.ts:349); transitionTime у horizontalMenu — 200мс, как --tabs-transition.
//
// Родитель должен резать горизонтальный overflow (overflow-x: hidden).
//
// Про `keepMounted` (порт того, как tweb держит табы) — см. докблок пропа.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import classNames from '../../lib/classNames'
import type { TabValue } from './Tabs'

const TRANSITION_TIME = 200 // tweb horizontalMenu(transitionTime = 200) == var(--tabs-transition)

interface Frame {
  tab: TabValue
  node: ReactNode
}

export default function TabSlide({
  tab,
  order,
  className,
  keepMounted,
  children,
}: {
  tab: TabValue
  /** значения табов в порядке отображения — по нему считается направление */
  order: readonly TabValue[]
  className?: string
  /**
   * Держать в DOM ВСЕ уже показанные табы — так устроен оригинал: `.tabs-container`
   * хранит все свои `.tabs-tab`, а `selectTab` лишь переставляет класс `active`
   * (`transition.ts:300-323`), и, например, скроллер папки создаётся один раз
   * (`appDialogsManager.addFilter`, `lib/appDialogsManager.ts:1249-1290`) и живёт
   * дальше сам по себе. Нужно там, где у таба есть СОБСТВЕННОЕ состояние DOM,
   * которое пересоздание узла потеряет: у списка чатов это `scrollTop` папки.
   *
   * Поддерево неактивного таба ЗАМОРОЖЕНО: в DOM живёт узел, с которым таб ушёл
   * (React пропускает поддерево, у которого не изменился элемент), свежий
   * `children` достаётся только активному. Возврат на таб отдаёт ему актуальное
   * поддерево, а состояние DOM и хуков переживает уход — ключ кадра тот же.
   *
   * Без пропа поведение прежнее: в DOM только текущий кадр (+ уходящий на время
   * слайда), уход таба его размонтирует.
   */
  keepMounted?: boolean
  children: ReactNode
}) {
  const els = useRef(new Map<TabValue, HTMLDivElement>())
  // последний отрисованный кадр: из него берётся уходящий контент (роль
  // AnimatePresence — держать старый узел в DOM, пока играет слайд)
  const lastRef = useRef<Frame>({ tab, node: children })
  const [exiting, setExiting] = useState<Frame | null>(null)
  const backwardsRef = useRef(false)
  // keepMounted: поддеревья всех показанных табов, в порядке первого показа.
  const mounted = useRef(new Map<TabValue, ReactNode>())

  if (lastRef.current.tab !== tab) {
    // tweb: toRight = prevId < id; при !toRight контейнер получает `backwards`
    backwardsRef.current = order.indexOf(tab) < order.indexOf(lastRef.current.tab)
    setExiting(lastRef.current) // правка состояния во время рендера — React перерисует сразу
  }
  lastRef.current = { tab, node: children }

  if (keepMounted) {
    // Актуальное поддерево получает активный таб; ушедшие держат то, с которым
    // ушли. Запись в ref на рендере идемпотентна (в т.ч. под StrictMode).
    mounted.current.set(tab, children)
    // Таба больше нет в `order` (папку удалили) — уходит и его кадр. ТЕКУЩИЙ
    // при этом неприкосновенен, даже если его самого уже нет в `order`:
    // рассинхрон «выбранный таб исчез из списка» живёт ровно до того, как
    // владелец выбора его починит (у папок — `foldersStore.applyFolderUpdate`),
    // а прополка без этой оговорки на этот кадр выкинула бы из DOM показанное
    // содержимое целиком — у списка чатов это пустая колонка вместо чатов.
    for (const t of mounted.current.keys()) {
      if (t !== tab && !order.includes(t)) mounted.current.delete(t)
    }
  }

  const exitingTab = exiting?.tab
  useLayoutEffect(() => {
    if (exitingTab === undefined) return

    // Фолбэк-таймер (transition.ts:349) ставится ДО всего остального и не зависит
    // от того, нашлись ли кадры: с `keepMounted` кадр уходящего таба может
    // исчезнуть в том же коммите (таб пропал из `order`), и тогда снимать
    // `exiting` было бы некому — на `.tabs-container` навсегда остался бы
    // `animating` (его читает _spoiler.scss:114).
    const timer = window.setTimeout(() => {
      setExiting((cur) => (cur?.tab === exitingTab ? null : cur))
    }, TRANSITION_TIME + 100)

    const to = els.current.get(tab)
    const from = els.current.get(exitingTab)
    if (!to || !from) return () => window.clearTimeout(timer)

    // slideTabs (transition.ts:56-70): ширина берётся у уходящего кадра, оба
    // получают стартовые transform, reflow фиксирует их, затем приходящий едет к 0.
    const width = from.getBoundingClientRect().width
    const [left, right] = backwardsRef.current ? [to, from] : [from, to]
    left.style.transform = `translate3d(${-width}px, 0, 0)`
    right.style.transform = `translate3d(${width}px, 0, 0)`
    void to.offsetWidth // reflow
    to.style.transform = ''

    const onEnd = (e: TransitionEvent) => {
      if (e.target !== from) return
      setExiting((cur) => (cur?.tab === exitingTab ? null : cur))
    }
    from.addEventListener('transitionend', onEnd)
    return () => {
      window.clearTimeout(timer)
      from.removeEventListener('transitionend', onEnd)
    }
  }, [exitingTab, tab])

  // Кадры — одним массивом с ключами: так React сохраняет DOM-узел уходящего
  // таба (иначе он пересоздался бы и слайд начался бы с пустого места).
  //
  // Отступление от tweb: порядок кадров в DOM у нас — порядок ПЕРВОГО ПОКАЗА
  // (порядок вставки в `mounted`), а tweb расставляет их по `localId` фильтра
  // (`positionElementByIndex`, `appDialogsManager.ts:1280`). Наблюдаемой разницы
  // нет — кадры лежат в одной ячейке грида (`.tabs-container`), показан всегда
  // ровно один (+ уходящий на время слайда), и порядок в DOM ни на геометрию, ни
  // на порядок отрисовки не влияет; заводить второй источник порядка табов ради
  // совпадения по DOM-дереву дороже, чем эта запись.
  const frames: Frame[] = keepMounted
    ? [...mounted.current].map(([t, node]) => ({ tab: t, node }))
    : exiting ? [exiting, { tab, node: children }] : [{ tab, node: children }]

  // Показан текущий таб, а на время слайда — ещё и уходящий (tweb: `active`
  // висит на обоих кадрах, пока играет переход). Без `keepMounted` других
  // кадров и не бывает, поэтому там условие всегда истинно, как и было.
  const isShown = (t: TabValue) => t === tab || t === exiting?.tab

  return (
    <div
      className={classNames(
        'tabs-container',
        exiting ? 'animating' : '',
        exiting && backwardsRef.current ? 'backwards' : '',
      )}
      data-animation="tabs"
    >
      {frames.map((f) => (
        <div
          key={String(f.tab)}
          // Какому табу принадлежит кадр — как tweb помечает скроллер папки
          // (`scrollable.container.dataset.filterId`, `autonomousDialogList/dialogs.ts:209`).
          data-tab={String(f.tab)}
          ref={(el) => {
            if (el) els.current.set(f.tab, el)
            else els.current.delete(f.tab)
          }}
          className={classNames('tabs-tab', isShown(f.tab) ? 'active' : '', className ?? '')}
        >
          {f.node}
        </div>
      ))}
    </div>
  )
}
