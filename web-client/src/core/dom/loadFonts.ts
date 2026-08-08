// Загрузка шрифтов вне критического рендер-пути (порт tweb helpers/dom/loadFonts +
// index.ts fadeInWhenFontsReady). @font-face объявлены в styles/_fonts.scss
// (tweb-бандл Roboto/Roboto Mono 400/500); здесь только прогрев через
// `document.fonts.load` — его промис даёт точку, по которой UI плавно проявляется.
// Веса — как tweb: [400, 500]; bold рендерится Medium-файлами (fix 600→Medium
// в _fonts.scss), настоящего Bold 700 в tweb нет.
import { pause } from '../accountTransition'

// Пробы: латиница + кириллица (как tweb texts ['b','б']) — заставляют браузер
// реально подтянуть нужные подмножества, а не только объявить @font-face.
const PROBES = ['b', 'б']
const WEIGHTS = [400, 500]

let promise: Promise<void> | null = null

// Один раз: дождаться готовности начертаний Roboto + Roboto Mono + иконочного
// tgico (как tweb helpers/dom/loadFonts.ts). Никогда не реджектит; жёсткий кап 1с
// (как tweb Promise.race([all, pause(1000)])) — на медленной сети не ждём вечно.
export function loadFonts(): Promise<void> {
  return (promise ??= (async () => {
    if (!('fonts' in document)) return

    const loads: Promise<unknown>[] = []
    for (const w of WEIGHTS) {
      for (const t of PROBES) {
        loads.push(document.fonts.load(`${w} 1rem Roboto`, t))
        loads.push(document.fonts.load(`${w} 1rem "Roboto Mono"`, t))
      }
    }
    loads.push(document.fonts.load('1rem tgico')) // иконочный шрифт (PUA-глифы)

    await Promise.race([
      Promise.all(loads).catch(() => { /* сбой загрузки шрифта — не критично */ }),
      pause(1000),
    ])
  })())
}

// Спрятать элемент (opacity 0) до готовности шрифтов, затем проявить — CSS-переход
// на элементе даёт мягкий fade (порт tweb fadeInWhenFontsReady). Instant-boot не
// ломаем: если шрифты уже в кэше (document.fonts.check) — не прячем вовсе, элемент
// показывается сразу. Возвращаемый промис — готовность (для координации).
export function fadeInWhenFontsReady(el: HTMLElement | null): Promise<void> {
  const ready = loadFonts()
  if (!el) return ready
  // Уже загружены (повторный заход) — не мигаем: показываем немедленно.
  const cached = 'fonts' in document && document.fonts.check('400 1rem Roboto', 'b')
  if (cached) return ready
  el.style.opacity = '0'
  void ready.then(() => {
    requestAnimationFrame(() => { el.style.opacity = '' }) // вернуть управление CSS
  })
  return ready
}
