// Порт tweb `src/components/groupCallActiveIcon.ts` (812502980) — иконка «в чате идёт
// видеочат» в строке списка: три столбца на канвасе 20×20, высота каждого ходит
// по easeInOutSine за секунду. Рисует `AutonomousDialogList.setCallStatus`.
//
// Расхождение с оригиналом: `customProperties.getProperty('primary-color')` — у нас
// `getComputedStyle(<html>).getPropertyValue('--primary-color')` (так читает цвета и
// `chatlist/dialogsPlaceholder.ts`; урезанный `customProperties` островка lottie
// префикса `--` не добавляет).
import { animate } from '@helpers/animation'
import roundRect from '@helpers/canvas/roundRect'
import mediaSizes from '@core/dom/mediaSizes'
import { easeInOutSine } from '@shared/lib/easeInOutSine'

const DPR = window.devicePixelRatio
const SIZE = 20 * DPR
const MARGIN = 2.5 * DPR
const WIDTH = 2 * DPR
const RADIUS = 1 * DPR
const LENGTH = 3

const MIN_HEIGHT = 4
const MAX_HEIGHT = 12
const DURATION = 1000

const primaryColor = () => getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim()

export default function groupCallActiveIcon(isActive = false) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const context = canvas.getContext('2d')!

  const TOTAL_WIDTH = LENGTH * WIDTH + (LENGTH - 1) * MARGIN
  const START_X = (SIZE - TOTAL_WIDTH) / 2

  const startTime = Date.now()
  // читается не на каждом кадре (getComputedStyle — пересчёт стилей), а при смене активности:
  // у tweb значение кешировано (`customProperties`)
  let activeColor = isActive ? primaryColor() : ''
  let wasMounted = false
  const renderFrame = () => {
    if(!canvas.isConnected) {
      if(wasMounted) {
        return false
      }
    } else if(!wasMounted) {
      wasMounted = canvas.isConnected
    }

    const time = Date.now()
    const progress = easeInOutSine((time - startTime) % DURATION, 0, 1, DURATION)

    context.clearRect(0, 0, SIZE, SIZE)
    context.fillStyle = isActive && !mediaSizes.isMobile ? activeColor : '#fff'

    for(let i = 0; i < LENGTH; ++i) {
      const x = START_X + (i * WIDTH) + (i * MARGIN)

      let itemProgress: number
      if(progress >= .5) {
        itemProgress = i % 2 ? 2 - progress * 2 : (progress - .5) * 2
      } else {
        itemProgress = i % 2 ? progress * 2 : 1 - progress * 2
      }

      let height = MIN_HEIGHT + (itemProgress * (MAX_HEIGHT - MIN_HEIGHT))
      height *= DPR
      const y = (SIZE - height) / 2

      roundRect(context, x, y, WIDTH, height, RADIUS, true)
    }

    return true
  }

  return {
    canvas,
    startAnimation: () => {
      animate(renderFrame)
      renderFrame()
    },
    setActive: (active: boolean) => {
      isActive = active
      if(active) activeColor = primaryColor()
      renderFrame()
    },
  }
}
