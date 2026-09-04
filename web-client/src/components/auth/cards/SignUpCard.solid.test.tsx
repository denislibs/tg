/** @jsxImportSource solid-js */
/**
 * Пины `SignUpCard.solid.tsx` (Solid-порт нашей React `cards/SignUpCard.tsx`,
 * которая сама — порт tweb `pages/cards/SignUpCard.tsx`, 181 строка).
 *
 * Поведенческий пин по сути карточки: имя/фамилия → `managers.auth.signUp`,
 * живой предпросмотр ФИО в тайтле, аватар выбирается ДО сабмита, а грузится
 * УЖЕ ПОД СЕССИЕЙ (см. докблок карточки — «сборка данных отправки» описывает,
 * почему интерактивный кроппер вне периметра задачи 5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import SignUpCard from './SignUpCard.solid'

// Мокаем реальным DocumentFragment'ом (не заглушкой) — так DOM-пин ниже
// («заголовок собирается через wrapEmojiText») проверяет и ВЫЗОВ, и то, что
// его РЕЗУЛЬТАТ реально попадает в `.title`, а не отбрасывается.
const wrapEmojiTextMock = vi.hoisted(() =>
  vi.fn((text: string) => {
    const frag = document.createDocumentFragment()
    frag.append(document.createTextNode(text))
    return frag
  }),
)
vi.mock('@lib/richtext/wrapEmojiText', () => ({ default: wrapEmojiTextMock }))

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
  wrapEmojiTextMock.mockClear()
  // Ревью задачи 6, «заодно»: раньше эти два вызова стояли в КОНЦЕ тела теста
  // на ресайз/конвертацию (ниже) — при падении ассерта ДО них спай на
  // `document.createElement` и стаб `createImageBitmap` протекали на остаток
  // файла. Здесь они безусловны и безопасны как no-op, если тест ничего не
  // мокал/стабил.
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount(auth: Partial<Managers['auth']> = {}, media: Partial<Managers['media']> = {}, profile: Partial<Managers['profile']> = {}) {
  const navigate = vi.fn()
  const toIm = vi.fn().mockResolvedValue(undefined)
  const managers = {
    auth: { signUp: vi.fn().mockResolvedValue({ user: {} }), ...auth },
    media: { upload: vi.fn().mockResolvedValue(999), ...media },
    profile: { addPhoto: vi.fn().mockResolvedValue({}), ...profile },
  } as unknown as Managers

  const ctx: AuthFlowContextValue = {
    managers,
    current: () => null,
    navigate,
    back: async () => {},
    toIm,
  }

  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    (() => (
      <AuthFlowContext.Provider value={ctx}>
        <SignUpCard spec={{ name: 'signUp', payload: { token: 'su-tok' } }} />
      </AuthFlowContext.Provider>
    )) as () => never,
    host,
  )

  const inputs = () => [...host!.querySelectorAll<HTMLDivElement>('.input-field-input')]
  const firstInput = () => inputs()[0]
  const lastInput = () => inputs()[1]
  const submitBtn = () => host!.querySelector('button') as HTMLButtonElement
  const setField = (el: HTMLDivElement, value: string) => {
    el.textContent = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const fileInput = () => host!.querySelector('input[type="file"]') as HTMLInputElement
  return { navigate, toIm, managers, firstInput, lastInput, submitBtn, setField, fileInput }
}

describe('SignUpCard.solid: живой предпросмотр ФИО', () => {
  it('пусто — заголовок «Your Name», ввод имени — заголовок = ФИО', () => {
    const { firstInput, lastInput, setField } = mount()
    expect(host!.querySelector('[class*="title"]')!.textContent).toBe('Your Name')

    setField(firstInput(), 'Ada')
    expect(host!.querySelector('[class*="title"]')!.textContent).toBe('Ada')

    setField(lastInput(), 'Lovelace')
    expect(host!.querySelector('[class*="title"]')!.textContent).toBe('Ada Lovelace')
  })
})

describe('SignUpCard.solid: сабмит', () => {
  it('пустое имя — ошибка в надпись кнопки, signUp НЕ зовётся', () => {
    const { managers, submitBtn } = mount()
    submitBtn().click()

    expect(submitBtn().textContent).toContain('Please enter your name')
    expect(managers.auth.signUp).not.toHaveBeenCalled()
  })

  it('успех БЕЗ аватара — signUp(token, first, last), upload НЕ зовётся, toIm()', async () => {
    const { toIm, managers, firstInput, lastInput, setField, submitBtn } = mount()
    setField(firstInput(), '  Ada  ')
    setField(lastInput(), ' Lovelace ')
    submitBtn().click()

    await vi.waitFor(() => expect(managers.auth.signUp).toHaveBeenCalled())
    expect(managers.auth.signUp).toHaveBeenCalledWith('su-tok', 'Ada', 'Lovelace', 'web', 'browser')
    expect(managers.media.upload).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
  })

  it('успех С аватаром — заливка идёт ПОСЛЕ signUp (уже под сессией), затем toIm()', async () => {
    const { toIm, managers, firstInput, setField, submitBtn, fileInput } = mount()
    setField(firstInput(), 'Ada')

    const file = new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' })
    Object.defineProperty(fileInput(), 'files', { value: [file], configurable: true })
    fileInput().dispatchEvent(new Event('change', { bubbles: true }))

    submitBtn().click()

    await vi.waitFor(() => expect(managers.auth.signUp).toHaveBeenCalled())
    await vi.waitFor(() => expect(managers.media.upload).toHaveBeenCalled())
    expect(managers.profile.addPhoto).toHaveBeenCalledWith(999)
    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
  })

  // Ревью задачи 6, находка 2: заливка шла БЕЗ ресайза/конвертации/width-height
  // — регресс против снесённой React-версии (`AvatarCropper` их считал). Закрыто
  // прогоном через `scaleImageForSend` (см. докблок карточки, «Ресайз/JPEG/
  // width-height»); пин — что её РЕЗУЛЬТАТ (не исходный файл) долетает до
  // `media.upload`. `createImageBitmap`/`canvas` мокаются ПОСЛЕ `mount()` — до
  // этой точки их использует сама карточка (реальный `<canvas id="canvas-
  // avatar">` в дереве, см. `onFileChosen`), подмена раньше сломала бы монтаж.
  it('файл, требующий ресайза/конвертации, уезжает в media.upload УЖЕ jpeg с width/height', async () => {
    const { managers, firstInput, setField, submitBtn, fileInput } = mount()
    setField(firstInput(), 'Ada')

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async (_file: Blob, opts?: { resizeWidth?: number; resizeHeight?: number }) => {
        if (opts?.resizeWidth != null) return { width: opts.resizeWidth, height: opts.resizeHeight, close: () => {} }
        // «Натуральный» размер выбранного файла — сторона > 2560, требует ресайза.
        return { width: 4000, height: 2000, close: () => {} }
      }),
    )
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }),
          toBlob: (cb: (b: Blob | null) => void, type?: string) => cb(new File(['out'], 'out', { type })),
        } as unknown as HTMLCanvasElement
      }
      return realCreateElement(tag)
    }) as typeof document.createElement)

    // PNG (совместимый формат) выбран НАРОЧНО — сторона > 2560 сама по себе
    // требует ресайза (needsResize), поэтому конвертация в jpeg не спутывается
    // с веткой needsConvert; несовместимый формат покрыт scaleImageForSend.test.ts.
    const file = new File([new Uint8Array([1, 2, 3])], 'big.png', { type: 'image/png' })
    Object.defineProperty(fileInput(), 'files', { value: [file], configurable: true })
    fileInput().dispatchEvent(new Event('change', { bubbles: true }))

    submitBtn().click()

    await vi.waitFor(() => expect(managers.media.upload).toHaveBeenCalled())
    expect(managers.media.upload).toHaveBeenCalledWith(
      expect.objectContaining({ mime: 'image/jpeg', width: 2560, height: 1280 }),
    )
    // Спай/стаб снимаются в общем afterEach (см. его комментарий) — не здесь,
    // чтобы падение ассерта строкой выше не оставляло их протекать на
    // остаток файла.
  })

  it('заливка аватара упала — это НЕ повод не пустить в мессенджер (toIm всё равно зовётся), отказ не тонет молча', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('upload failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { toIm, firstInput, setField, submitBtn, fileInput } = mount({}, { upload })
    setField(firstInput(), 'Ada')

    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
    Object.defineProperty(fileInput(), 'files', { value: [file], configurable: true })
    fileInput().dispatchEvent(new Event('change', { bubbles: true }))

    submitBtn().click()
    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
    // console.error — не проглоченный отказ (см. докблок карточки, «не тонет молча»).
    expect(errorSpy).toHaveBeenCalledWith('SignUpCard: не удалось загрузить аватар', expect.any(Error))
    errorSpy.mockRestore()
  })

  it('signup_token_expired / phone_number_occupied — назад на signIn (токена больше нет)', async () => {
    const signUp = vi.fn().mockResolvedValue({ error: 'signup_token_expired' })
    const { navigate, firstInput, setField, submitBtn } = mount({ signUp })
    setField(firstInput(), 'Ada')
    submitBtn().click()

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'signIn' }))
  })

  it('прочая ошибка сервера — текст в надпись кнопки, карточка остаётся', async () => {
    const signUp = vi.fn().mockResolvedValue({ error: 'too_many_requests' })
    const { navigate, firstInput, setField, submitBtn } = mount({ signUp })
    setField(firstInput(), 'Ada')
    submitBtn().click()

    await vi.waitFor(() => expect(submitBtn().textContent).toContain('Too many attempts'))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('слишком длинное имя — кнопка задизейблена клиентски, signUp не зовётся', () => {
    const { managers, firstInput, setField, submitBtn } = mount()
    setField(firstInput(), 'A'.repeat(71))

    expect(submitBtn().disabled).toBe(true)
    submitBtn().click()
    expect(managers.auth.signUp).not.toHaveBeenCalled()
  })
})

describe('SignUpCard.solid: сетевой отказ на сабмите — не запертая карточка (ревью 5, находка 2)', () => {
  // signUp() перебрасывает НЕ-HttpError наружу (обрыв сети/отказ worker-RPC)
  // так же, как signImport/confirmPasswordRecovery — прежний код звал её БЕЗ
  // try/catch при уже взведённом busy(true): отказ давал необработанное
  // отклонение, кнопка оставалась disabled навсегда с «Please wait…».
  // Оригинал ловит (tweb SignUpCard.tsx:127-135); образец в этом каталоге —
  // PasswordCard.solid.tsx::submitPassword.
  it('signUp() отклонился — busy снимается, ошибка в надписи кнопки, кнопка снова доступна', async () => {
    const signUp = vi.fn().mockRejectedValue(new Error('network down'))
    const { firstInput, setField, submitBtn } = mount({ signUp })
    setField(firstInput(), 'Ada')
    submitBtn().click()

    await vi.waitFor(() => expect(submitBtn().textContent).toContain('Something went wrong'))
    expect(submitBtn().disabled).toBe(false)
  })
})

describe('SignUpCard.solid: blurActiveElement вместо autoFocus (ревью 5, «заодно»)', () => {
  // tweb SignUpCard.tsx:151 — onMount зовёт blurActiveElement() (снимает
  // фокус с чего бы он ни был — карточка приходит СРАЗУ после ввода кода,
  // где было сфокусировано поле кода), а не автофокусит имя. Прежняя
  // редакция ставила `autoFocus` на первое поле — отступление от источника
  // поведения.
  it('на монтировании снимает фокус (blurActiveElement), а не автофокусит поле имени', () => {
    const decoy = document.createElement('input')
    document.body.append(decoy)
    decoy.focus()
    expect(document.activeElement).toBe(decoy)

    mount()

    expect(document.activeElement).not.toBe(decoy)
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true)
    decoy.remove()
  })
})

describe('SignUpCard.solid: живой предпросмотр ФИО разбирает эмодзи (ревью 5, «заодно»)', () => {
  // tweb SignUpCard.tsx:77-80 — предпросмотр строится через wrapEmojiText, не
  // голой строкой: кастомные эмодзи в имени должны отрисоваться. Прежняя
  // редакция клала `fullName()` в тайтл текстом напрямую — модуль
  // `wrapEmojiText` вообще не звался.
  it('заголовок собирается через wrapEmojiText(fullName), а не присваиванием голой строки', async () => {
    const { firstInput, lastInput, setField } = mount()
    setField(firstInput(), 'Ada')
    setField(lastInput(), 'Lovelace')

    expect(wrapEmojiTextMock).toHaveBeenCalledWith('Ada Lovelace')
    // Возврат мока — реальный DocumentFragment с текстовым узлом; попадает в
    // DOM, как и настоящий wrapRichText().
    expect(host!.querySelector('[class*="title"]')!.textContent).toBe('Ada Lovelace')
  })

  it('пустое имя НЕ зовёт wrapEmojiText — фолбэк «Your Name» идёт мимо него', () => {
    mount()
    expect(wrapEmojiTextMock).not.toHaveBeenCalled()
  })
})
