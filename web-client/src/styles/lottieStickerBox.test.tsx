// Габариты lottie-иллюстрации задаёт КОНТЕЙНЕР, а не сама канва.
//
// Канва плеера приезжает в DOM с глобальным классом `lottie` (`lib/lottie/
// lottiePlayer.ts:280` — `canvas.classList.add('lottie')`, аппенд на первом
// кадре `lottiePlayer.ts:1207`), а этот класс — АБСОЛЮТНАЯ растяжка:
// `position:absolute; inset:0; width:100%; height:100%` (`styles/index.scss`
// `.lottie` = tweb `src/scss/base.scss:1214-1226`). Значит реальный размер
// иллюстрации равен блоку-контейнеру канвы — ближайшему ПОЗИЦИОНИРОВАННОМУ
// предку, и если контейнер стикера позиционирование не заводит, канва
// «проваливается» на первый попавшийся позиционированный узел выше.
//
// В оригинале контейнер всегда позиционирован и всегда ровно размера стикера:
// tweb `src/components/mediaHeader.module.scss:31-46` — `.sticker
// {position:relative; width/height: var(--sticker-size)}` и вложенный
// `.lottie {width/height: var(--size); max-width/max-height:100%;
// position:relative}`; ту же обёртку носят ВСЕ места показа встроенных
// ассетов (tweb `mediaHeader.tsx:63-79`, `pages/cards/PasswordCard.tsx:228`
// — обезьянка едет в `MediaHeader.Sticker element={monkeyContainer}`).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СТИЛЕВОЙ ПИН. Пины разметки (`components/LottieSticker.
// test.tsx`, `components/PasswordMonkey.test.tsx`) сверяют проводку —
// «позвали `loadAnimationAsAsset` с width/height: size» — и остаются
// зелёными при любом размере на экране: размер канвы в опциях плеера это
// разрешение отрисовки, а не CSS-габарит. Именно так и вышел дефект: у
// попапа passkey ключ раздувался на всю карточку (`.popup-container`
// — `position: relative`, `styles/tweb/popups/_popup.scss:80-82`), перекрывая
// заголовок, три ряда и кнопки; на экране пасскода обезьянка растягивалась на
// весь `position:fixed` оверлей. Поэтому здесь — НАСТОЯЩИЙ скомпилированный
// `styles/index.scss` поверх НАСТОЯЩЕЙ разметки (`PasskeyIntroPopup`,
// `LottieSticker`, `PasswordMonkey`), тем же способом, что
// `styles/pollClickableArea.test.ts` и `styles/spoilerPlate.test.ts`.
//
// Оба режима показа меряются ОДНОЙ мерой: канва (SIMD есть) и статичный PNG
// первого кадра (`lib/lottie/lottieAssetFallback.ts`, деградация без WASM
// SIMD) заданы в процентах, поэтому обоих меряет их блок-контейнер.
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'
import { render, cleanup } from '@testing-library/react'

const { loadAnimationAsAsset } = vi.hoisted(() => ({ loadAnimationAsAsset: vi.fn() }))
vi.mock('@lib/lottie/lottieLoader', () => ({ default: { loadAnimationAsAsset } }))

import type { LottieAssetName } from '@lib/lottie/lottieLoader'
import { renderStaticAssetFallback } from '@lib/lottie/lottieAssetFallback'
import { ManagersProvider } from '@core/hooks/useManagers'
import type { Managers } from '@/client/bootstrap'
import PasskeyIntroPopup from '@components/settings/PasskeyIntroPopup'
import LottieSticker from '@components/LottieSticker'
import PasswordMonkey from '@components/PasswordMonkey'
import '../test/lang'

let css: string

beforeAll(() => {
  css = sass.compile(join(__dirname, 'index.scss'), {
    loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
    // Предупреждения вендорного tweb-SCSS к предмету теста отношения не имеют.
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
})

afterEach(() => {
  cleanup()
  loadAnimationAsAsset.mockReset()
  document.head.replaceChildren()
  document.body.replaceChildren()
})

function mountStyles() {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
}

/**
 * Канва плеера — ровно та, что кладёт в контейнер tlottie: класс `lottie`
 * (`lib/lottie/lottiePlayer.ts:279-284`) и аппенд первым кадром (`:1207`).
 * Плеер целиком (воркер + wasm) в прогоне не поднять, поэтому его DOM-след
 * воспроизводится здесь — предмет пина не плеер, а габарит контейнера.
 */
function playerAppendsCanvas() {
  loadAnimationAsAsset.mockImplementation((params: { container: HTMLElement }) => {
    const canvas = document.createElement('canvas')
    canvas.classList.add('lottie')
    params.container.append(canvas)
    return Promise.resolve({ remove: () => {}, playOrRestart: () => {} })
  })
}

/**
 * Деградация без WASM SIMD: `loadAnimationAsAsset` вставляет статичный PNG
 * первого кадра в контейнер ДО реджекта `NO_WASM` (`lib/lottie/lottieLoader.
 * ts` + `lottieAssetFallback.ts`) — сам фолбэк здесь НАСТОЯЩИЙ.
 */
function loaderFallsBackToPng() {
  loadAnimationAsAsset.mockImplementation((params: { container: HTMLElement }, name: LottieAssetName) => {
    renderStaticAssetFallback(params.container, name)
    return Promise.reject(new Error('NO_WASM'))
  })
}

/**
 * Ближайший позиционированный предок — блок-контейнер для `position:absolute`.
 *
 * У неуказанного `position` happy-dom отдаёт пустую строку, а не `static`
 * (замер: `getComputedStyle(div).position === ''`), поэтому «в потоке» здесь
 * — обе эти строки; иначе базой стал бы любой родитель и пин охранял бы
 * пустоту (проверено: с наивным `!== 'static'` он зелен и с дефектом).
 */
function positionedAncestor(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const {position} = getComputedStyle(p)
    if (position && position !== 'static') return p
  }
  return null
}

/**
 * Габарит, который иллюстрация реально займёт на экране.
 *
 * И канва, и PNG-фолбэк растянуты на 100%/100% своего блока-контейнера,
 * поэтому «размер иллюстрации» — это размер контейнера: для абсолютной канвы
 * ближайший позиционированный предок, для PNG в потоке — родитель.
 */
function illustrationBox(el: HTMLElement) {
  const own = getComputedStyle(el)
  expect([own.width, own.height]).toEqual(['100%', '100%'])
  const box = own.position === 'absolute' ? positionedAncestor(el)! : el.parentElement!
  const boxStyle = getComputedStyle(box)
  return { box, width: boxStyle.width, height: boxStyle.height }
}

const managers = {} as Managers

async function mountPasskeyPopup() {
  mountStyles()
  render(
    <ManagersProvider managers={managers}>
      <PasskeyIntroPopup open onClose={() => {}} onCreated={() => {}} />
    </ManagersProvider>,
  )
  const card = await vi.waitFor(() => {
    const el = document.querySelector<HTMLElement>('.popup-container')
    expect(el).not.toBeNull()
    return el!
  })
  return card
}

/** Размер ключа в попапе passkey — tweb `popups/passkey.tsx:39-42` (`size: 120`). */
const KEY_SIZE = '120px'

describe('попап passkey: иллюстрация-ключ', () => {
  it('канва анимации ограничена стикером 120×120, а не карточкой попапа', async () => {
    playerAppendsCanvas()
    const card = await mountPasskeyPopup()

    const canvas = await vi.waitFor(() => {
      const el = card.querySelector<HTMLElement>('canvas.lottie')
      expect(el).not.toBeNull()
      return el!
    })

    const { box, width, height } = illustrationBox(canvas)
    expect(box).not.toBe(card)
    expect([width, height]).toEqual([KEY_SIZE, KEY_SIZE])
  })

  it('статичный PNG (без WASM SIMD) — тот же бокс 120×120', async () => {
    loaderFallsBackToPng()
    const card = await mountPasskeyPopup()

    const img = await vi.waitFor(() => {
      const el = card.querySelector<HTMLElement>('img.lottie-asset-fallback')
      expect(el).not.toBeNull()
      return el!
    })

    const { box, width, height } = illustrationBox(img)
    expect(box).not.toBe(card)
    expect([width, height]).toEqual([KEY_SIZE, KEY_SIZE])
  })

  it('иллюстрация не перекрывает текст: заголовок, три ряда и кнопки — вне её бокса', async () => {
    playerAppendsCanvas()
    const card = await mountPasskeyPopup()
    const canvas = await vi.waitFor(() => card.querySelector<HTMLElement>('canvas.lottie')!)

    const { box } = illustrationBox(canvas)
    // Всё содержимое карточки, кроме самого слота стикера, обязано лежать
    // ВНЕ бокса иллюстрации — иначе канва ляжет поверх текста и кнопок.
    const covered = Array.from(card.children).filter((child) => box.contains(child))
    expect(covered).toHaveLength(0)
  })
})

describe('те же габариты у остальных мест показа встроенных ассетов', () => {
  // Папки (`ChatFoldersSettings.tsx:84`/`FolderEditor.tsx:231` — 86px) и
  // конверт/уточки настроек ходят через тот же `LottieSticker`.
  it.each([
    ['Folders_1' as LottieAssetName, 86],
    ['UtyanDisappear' as LottieAssetName, 120],
    ['UtyanSearch' as LottieAssetName, 140],
  ])('LottieSticker %s ограничен %dpx даже внутри позиционированного предка', async (name, size) => {
    playerAppendsCanvas()
    mountStyles()
    // Позиционированный предок вокруг — как `.popup-container` у попапа или
    // `position:fixed` оверлей у экрана пасскода: без своей базы канва уедет
    // на него.
    render(
      <div style={{ position: 'relative', width: 400, height: 500 }}>
        <LottieSticker name={name} size={size} />
      </div>,
    )
    const canvas = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>('canvas.lottie')
      expect(el).not.toBeNull()
      return el!
    })

    const { width, height } = illustrationBox(canvas)
    expect([width, height]).toEqual([`${size}px`, `${size}px`])
  })

  // Обезьянка пароля (`PasscodeLockScreen.tsx:56`, `settings/
  // TwoStepVerification.tsx:72`) — свой контейнер `.media-sticker-wrapper`,
  // в оригинале он лежит в `MediaHeader.Sticker` (tweb `pages/cards/
  // PasswordCard.tsx:228`), то есть тоже в позиционированном боксе размера
  // стикера.
  it('PasswordMonkey ограничен 140×140, а не полноэкранным оверлеем блокировки', async () => {
    playerAppendsCanvas()
    mountStyles()
    render(
      <div style={{ position: 'fixed', inset: 0 }}>
        <PasswordMonkey peeking={false} size={140} />
      </div>,
    )
    const canvas = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>('canvas.lottie')
      expect(el).not.toBeNull()
      return el!
    })

    const { width, height } = illustrationBox(canvas)
    expect([width, height]).toEqual(['140px', '140px'])
  })
})
