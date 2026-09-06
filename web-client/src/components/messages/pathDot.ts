// Порт `tweb/src/components/chat/bubbleParts/pollMessageContent/PathDot.tsx` —
// «летящая точка», которая после голосования пробегает Г-образный путь от
// чекбокса варианта к его полоске результата и лишь ПО ОКОНЧАНИИ пути отдаёт
// место проценту (`onAnimationEnd` → `canShowPercentage`, PollOption.tsx:72,196).
// Без неё процент выскакивал бы мгновенно — расхождение видно глазом.
//
// Форма против оригинала: Solid-компонент превращён в ванильную фабрику по
// приёму `components/progressRing.ts` (вызывающий — императивная лента).
// `onCleanup` оригинала выражен методом `destroy` хендла.

export interface PathDotOptions {
  /** Ширина прямоугольника (внутренняя, без обводки). */
  width?: number
  /** Высота прямоугольника. */
  height?: number
  /** Радиус скругления угла. */
  radius?: number
  /** Цвет точки. */
  dotColor?: string
  /** Толщина точки (ширина обводки движущегося штриха). */
  dotThickness?: number
  /** Длина вытянутой точки в процентах от всего пути (0–100). */
  dotLength?: number
  /** Длительность анимации в секундах. */
  duration?: number
  /** Обратное направление. */
  reverse?: boolean
  /** Поля вокруг прямоугольника, чтобы обводку не срезало. */
  padding?: number
  className?: string
  /** Зовётся один раз по завершении (не зовётся при отмене). */
  onAnimationEnd?: () => void
}

export interface PathDotHandle {
  element: SVGSVGElement
  destroy: VoidFunction
}

const NS = 'http://www.w3.org/2000/svg'

const DEFAULTS = {
  width: 160,
  height: 100,
  radius: 20,
  dotColor: 'var(--primary-color)',
  dotThickness: 6,
  dotLength: 8,
  duration: 2,
  reverse: false,
  padding: 8,
} as const

export function createPathDot(rawOpts: PathDotOptions = {}): PathDotHandle {
  const props = { ...DEFAULTS, ...rawOpts }

  // Радиус зажат половиной меньшей стороны, иначе дуга вывернется (tweb :44).
  const r = Math.min(props.radius, props.width / 2, props.height / 2)
  const pad = props.padding + props.dotThickness / 2

  // Открытый Г-образный путь (tweb :53-68):
  //   старт — левый верхний, отступ ВНИЗ на R, чтобы не сидеть в скруглении;
  //   → вниз → скруглённый левый нижний угол → вправо;
  //   финиш — правый нижний, отступ ВЛЕВО на R.
  const d = [
    `M ${pad} ${pad + r}`,
    `L ${pad} ${pad + props.height - r}`,
    `A ${r} ${r} 0 0 0 ${pad + r} ${pad + props.height}`,
    `L ${pad + props.width - r} ${pad + props.height}`,
  ].join(' ')

  const svgWidth = props.width + pad * 2
  const svgHeight = props.height + pad * 2

  const element = document.createElementNS(NS, 'svg')
  if (props.className) element.setAttributeNS(null, 'class', props.className)
  element.setAttributeNS(null, 'width', '' + svgWidth)
  element.setAttributeNS(null, 'height', '' + svgHeight)
  element.setAttributeNS(null, 'viewBox', `0 0 ${svgWidth} ${svgHeight}`)

  const path = document.createElementNS(NS, 'path')
  path.setAttributeNS(null, 'd', d)
  path.setAttributeNS(null, 'fill', 'none')
  path.setAttributeNS(null, 'stroke', props.dotColor)
  path.setAttributeNS(null, 'stroke-width', '' + props.dotThickness)
  path.setAttributeNS(null, 'stroke-linecap', 'round')
  // pathLength=100 нормирует путь, поэтому dotLength — сразу проценты (tweb :71).
  path.setAttributeNS(null, 'pathLength', '100')
  path.setAttributeNS(null, 'stroke-dasharray', `${props.dotLength} ${100 - props.dotLength}`)
  path.setAttributeNS(
    null,
    'stroke-dashoffset',
    props.reverse ? `${-(100 - props.dotLength)}` : '0',
  )
  element.append(path)

  // Путь открытый: штрих сдвигается на `100 - dotLength * 2`, чтобы точка
  // оставалась целиком видимой всю дорогу (tweb :80-82).
  const travel = 100 - props.dotLength * 2
  const from = props.reverse ? `${-travel}` : '0'
  const to = props.reverse ? '0' : `${-travel}`

  // happy-dom (наш тестовый рантайм) WAAPI не реализует: без гейта фабрика
  // падала бы в каждом тесте ленты, где есть проголосованный опрос.
  const animation = typeof path.animate === 'function'
    ? path.animate([{ strokeDashoffset: from }, { strokeDashoffset: to }], {
      duration: props.duration * 1000,
      easing: 'ease-in',
      fill: 'forwards',
      iterations: 1,
    })
    : undefined

  let cancelled = false

  if (animation) {
    animation.finished
      .then(() => props.onAnimationEnd?.())
      .catch(() => {
        // Анимацию отменили — молчим (tweb :99-101).
      })
  } else {
    // Без WAAPI конец объявляется СЛЕДУЮЩИМ тиком, а не сразу: `onAnimationEnd`
    // у вызывающего перерисовывает то самое поддерево, внутри отрисовки
    // которого фабрика и вызвана, — синхронный вызов был бы реэнтерабельным.
    // `animation.finished` оригинала тоже разрешается асинхронно.
    void Promise.resolve().then(() => {
      if (!cancelled) props.onAnimationEnd?.()
    })
  }

  return {
    element,
    destroy: () => {
      cancelled = true
      animation?.cancel()
    },
  }
}
