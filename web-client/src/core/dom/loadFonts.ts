// Загрузка шрифтов вне критического рендер-пути (порт tweb helpers/dom/loadFonts +
// index.ts fadeInWhenFontsReady). Раньше @fontsource/roboto/{400,500,700}.css
// импортировались статикой в main.tsx — их @font-face попадал в критический CSS
// бандла. Теперь CSS подтягивается динамическим импортом (отдельный чанк, off
// критпуть), а `document.fonts.load` даёт промис готовности, по которому UI
// плавно проявляется. Корректные unicode-подмножества @fontsource сохранены —
// @font-face руками не переписываем.
import { pause } from '../accountTransition'

// Пробы: латиница + кириллица (как tweb texts ['b','б']) — заставляют браузер
// реально подтянуть нужные подмножества, а не только объявить @font-face.
const PROBES = ['b', 'б']
const WEIGHTS = [400, 500, 700]

let promise: Promise<void> | null = null

// Один раз: подключить @font-face (dynamic import CSS) и дождаться готовности
// всех начертаний Roboto + иконочного tgico. Никогда не реджектит; жёсткий кап 1с
// (как tweb Promise.race([all, pause(1000)])) — на медленной сети не ждём вечно.
export function loadFonts(): Promise<void> {
  return (promise ??= (async () => {
    // @font-face уводим в ленивый чанк (инъекция CSS происходит на резолве импорта).
    await Promise.all([
      import('@fontsource/roboto/400.css'),
      import('@fontsource/roboto/500.css'),
      import('@fontsource/roboto/700.css'),
    ]).catch(() => { /* CSS не подгрузился — деградируем на системный фолбэк */ })

    if (!('fonts' in document)) return

    const loads: Promise<unknown>[] = []
    for (const w of WEIGHTS) for (const t of PROBES) loads.push(document.fonts.load(`${w} 1rem Roboto`, t))
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
