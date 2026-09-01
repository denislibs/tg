// src/shared/ui/InputSearch/InputSearch.test.tsx
// Порт tweb `inputSearch.ts:143-198` — три возможности, которыми пользуется
// автомат состояния соединения: isLoading / toggleLoading / setPlaceholder.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import I18n from '@lib/langPack'
import InputSearch, { CONNECTION_ANIMATION_DURATION, type InputSearchStatus } from './InputSearch'
import { MemberPicker } from '../../../components/group/screens/shared'
import { useSettingsStore } from '../../../settings'

function renderInput(props: Partial<Parameters<typeof InputSearch>[0]> = {}) {
  const statusRef = createRef<InputSearchStatus>()
  const view = render(<InputSearch value="" onChange={() => {}} statusRef={statusRef} {...props} />)
  const root = document.querySelector<HTMLElement>('.input-search')!
  return { statusRef, root, view }
}

const placeholders = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.input-search-placeholder')]

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  // гейт анимаций (`liteMode.isAvailable('animations')` → настройка «Без анимаций»):
  // при выключенных анимациях setTransition применяет переход синхронно,
  // см. отдельный тест ниже
  useSettingsStore.setState({ reduceMotion: false })
  vi.useRealTimers()
})

describe('InputSearch.toggleLoading — спиннер вместо лупы (tweb :147-173)', () => {
  it('вход в загрузку: is-connecting на контейнере, isLoading() === true, спиннер в DOM', () => {
    const { statusRef, root } = renderInput()
    expect(statusRef.current!.isLoading()).toBe(false)

    act(() => statusRef.current!.toggleLoading(true))

    expect(root.classList.contains('is-connecting')).toBe(true)
    expect(statusRef.current!.isLoading()).toBe(true)

    const preloader = root.querySelector<HTMLElement>('.preloader-container')!
    expect(preloader).toBeTruthy()
    // tweb :150-153: cancelable:false → preloader-swing; constructContainer({color:'transparent', bold:true})
    expect(preloader.className.split(' ').sort()).toEqual(
      ['is-visible', 'preloader-bold', 'preloader-container', 'preloader-swing', 'preloader-transparent', 'will-animate'].sort(),
    )
    expect(preloader.querySelector('.you-spin-me-round svg.preloader-circular circle.preloader-path-new')).toBeTruthy()
  })

  it('спиннер создаётся лениво и ровно один раз — повторные вызовы переиспользуют узел', () => {
    const { statusRef, root } = renderInput()
    expect(root.querySelector('.preloader-container')).toBeNull()

    act(() => statusRef.current!.toggleLoading(true))
    const first = root.querySelector('.preloader-container')
    act(() => statusRef.current!.toggleLoading(false))
    act(() => { vi.advanceTimersByTime(CONNECTION_ANIMATION_DURATION) })
    act(() => statusRef.current!.toggleLoading(true))

    expect(root.querySelectorAll('.preloader-container')).toHaveLength(1)
    expect(root.querySelector('.preloader-container')).toBe(first)
  })

  it('выход: спиннер остаётся в DOM с is-hiding и снимается только по окончании обратной анимации (tweb :168-170)', () => {
    const { statusRef, root } = renderInput()
    act(() => statusRef.current!.toggleLoading(true))
    act(() => statusRef.current!.toggleLoading(false))

    const preloader = root.querySelector<HTMLElement>('.preloader-container')!
    expect(preloader.classList.contains('is-hiding')).toBe(true)

    act(() => { vi.advanceTimersByTime(CONNECTION_ANIMATION_DURATION - 1) })
    expect(root.querySelector('.preloader-container')).toBe(preloader)
    expect(statusRef.current!.isLoading()).toBe(true)

    act(() => { vi.advanceTimersByTime(1) })
    expect(root.querySelector('.preloader-container')).toBeNull()
    expect(root.classList.contains('is-connecting')).toBe(false)
    expect(statusRef.current!.isLoading()).toBe(false)
  })

  it('лупа гаснет по is-hiding на загрузке и возвращается на выходе (tweb :162)', () => {
    const { statusRef, root } = renderInput()
    const icon = root.querySelector<HTMLElement>('.input-search-icon')!

    act(() => statusRef.current!.toggleLoading(true))
    expect(icon.classList.contains('is-hiding')).toBe(true)
    expect(icon.classList.contains('will-animate')).toBe(true)

    act(() => statusRef.current!.toggleLoading(false))
    expect(icon.classList.contains('is-hiding')).toBe(false)
  })

  it('will-animate появляется на лупе только с первой загрузкой (tweb :154, createIcon его не ставит)', () => {
    const { statusRef, root } = renderInput()
    const icon = root.querySelector<HTMLElement>('.input-search-icon')!
    // до первого toggleLoading лупа не должна проигрывать grow-input при монтировании
    expect(icon.classList.contains('will-animate')).toBe(false)

    act(() => statusRef.current!.toggleLoading(true))
    expect(icon.classList.contains('will-animate')).toBe(true)
  })

  it('повторный вход в загрузку не перевешивает спиннер в конец контейнера (tweb :157)', () => {
    // `root.append` на уже вставленном узле — это remove+insert, то есть перезапуск
    // CSS-анимации grow-input; автомат зовёт toggleLoading(true) на каждом переходе,
    // пока идёт коннект, и спиннер дёргался бы на каждом
    const { statusRef, root } = renderInput()
    act(() => statusRef.current!.toggleLoading(true))
    act(() => statusRef.current!.setPlaceholder('Updating'))
    const preloader = root.querySelector<HTMLElement>('.preloader-container')!
    const placeholder = root.querySelector<HTMLElement>('.input-search-placeholder')!
    expect(root.lastElementChild).toBe(placeholder)

    act(() => statusRef.current!.toggleLoading(true))

    expect(root.lastElementChild).toBe(placeholder)
    expect(preloader.nextElementSibling).toBe(placeholder)
  })

  it('toggleLoading(false) без предшествующего входа не зажигает is-connecting даже на время анимации', () => {
    // tweb singleTransition.ts:50 — className навешивается только на прямом ходе.
    // Автомат зовёт toggleLoading(false) на штатном старте, и isLoading() обязан
    // остаться false, иначе он выберет ветку «показать немедленно».
    const { statusRef, root } = renderInput()
    act(() => statusRef.current!.toggleLoading(false))
    expect(root.classList.contains('is-connecting')).toBe(false)
    expect(statusRef.current!.isLoading()).toBe(false)
  })

  it('при выключенных анимациях спиннер снимается сразу, без таймера', () => {
    useSettingsStore.setState({ reduceMotion: true })
    const { statusRef, root } = renderInput()
    act(() => statusRef.current!.toggleLoading(true))
    expect(root.querySelector('.preloader-container')).toBeTruthy()

    act(() => statusRef.current!.toggleLoading(false))
    expect(root.querySelector('.preloader-container')).toBeNull()
  })

  it('перерисовка React не сносит классы перехода с контейнера', () => {
    // классы корня ведёт императивный слой; если вернуть их пропом className,
    // React перепишет строку целиком на смене `focused` и сотрёт is-connecting
    const { statusRef, root, view } = renderInput({ focused: false })
    act(() => statusRef.current!.toggleLoading(true))

    view.rerender(<InputSearch value="" onChange={() => {}} statusRef={statusRef} focused />)

    expect(root.classList.contains('is-connecting')).toBe(true)
    expect(root.classList.contains('input-search')).toBe(true)
  })

  it('снятие focused убирает свой токен с корня', () => {
    // обратная половина диффа: без неё акцентная рамка залипает навсегда —
    // `Sidebar.tsx` передаёт `focused={searching}` и снимает его по closeSearch
    const { statusRef, root, view } = renderInput({ focused: true })
    const focusedToken = [...root.classList].find((token) => token !== 'input-search')
    expect(focusedToken).toBeTruthy()

    view.rerender(<InputSearch value="" onChange={() => {}} statusRef={statusRef} focused={false} />)

    expect(root.classList.contains(focusedToken!)).toBe(false)
    expect(root.classList.contains('input-search')).toBe(true)
  })

  it('смена className вызывающим снимает старый токен, а не копит их', () => {
    const { statusRef, root, view } = renderInput({ className: 'old-style' })
    expect(root.classList.contains('old-style')).toBe(true)

    view.rerender(
      <InputSearch value="" onChange={() => {}} statusRef={statusRef} className="emoticons-search-input-container" />,
    )

    expect(root.classList.contains('old-style')).toBe(false)
    expect(root.classList.contains('emoticons-search-input-container')).toBe(true)
  })
})

describe('InputSearch.setPlaceholder — кросс-фейд (tweb :175-198)', () => {
  it('во время перехода в DOM ровно два узла: старый с is-hiding и новый', () => {
    const { statusRef, root } = renderInput()
    act(() => statusRef.current!.setPlaceholder('Search'))
    act(() => statusRef.current!.setPlaceholder('Updating'))

    const nodes = placeholders(root)
    expect(nodes).toHaveLength(2)
    expect(nodes[0].textContent).toBe('Search')
    expect(nodes[0].classList.contains('is-hiding')).toBe(true)
    expect(nodes[1].textContent).toBe('Updating...')
    expect(nodes[1].classList.contains('is-hiding')).toBe(false)
    expect(nodes[1].className.split(' ').sort()).toEqual(['i18n', 'input-search-placeholder', 'will-animate'])
    // Класс `.i18n` НАСТОЯЩИЙ: узел построен `i18n(key)` и записан в `weakMap`,
    // поэтому его найдёт и перепишет `applyLangPack`. Прежде этот `span` с тем
    // же классом создавался здесь руками, а текст в него клал вызывающий —
    // обход находил узел, `weakMap.get` давал `undefined`, и узел молча
    // пропускался. Именно из-за этого автомат состояния соединения держал СВОЮ
    // подписку на язык (задача #118).
    expect(I18n.weakMap.get(nodes[1])).toBeDefined()
  })

  it('после окончания анимации остаётся один узел — новый', () => {
    const { statusRef, root } = renderInput()
    act(() => statusRef.current!.setPlaceholder('Search'))
    act(() => statusRef.current!.setPlaceholder('Updating'))

    act(() => { vi.advanceTimersByTime(CONNECTION_ANIMATION_DURATION) })

    const nodes = placeholders(root)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].textContent).toBe('Updating...')
  })

  it('повторный вызов с тем же ключом — no-op: узел не пересоздаётся (tweb :176)', () => {
    const { statusRef, root } = renderInput()
    // так автомат покажет обратный отсчёт: живой узел с секундами он мутирует
    // сам, а setPlaceholder зовёт с одним и тем же ключом каждый тик
    const timer = document.createElement('span')
    timer.textContent = '12'
    act(() => statusRef.current!.setPlaceholder('ConnectionStatus.ReconnectInPlain', [timer]))
    const node = placeholders(root)[0]

    timer.textContent = '11'
    act(() => statusRef.current!.setPlaceholder('ConnectionStatus.ReconnectInPlain', [document.createElement('span')]))

    expect(placeholders(root)).toHaveLength(1)
    expect(placeholders(root)[0]).toBe(node)
    expect(node.contains(timer)).toBe(true)
    // Узел несёт ВСЮ фразу ключа с подставленным аргументом — секунды живут
    // внутри неё отдельным `<span>`, который автомат мутирует сам.
    expect(node.textContent).toContain('11')
  })
})

describe('InputSearch — декларативный проп placeholder', () => {
  it('проп рендерит тот же узел плейсхолдера', () => {
    const { root } = renderInput({ placeholder: 'Search' })
    const nodes = placeholders(root)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].textContent).toBe('Search')
    expect(nodes[0].classList.contains('will-animate')).toBe(true)
  })

  it('смена пропа даёт тот же кросс-фейд', () => {
    const { statusRef, root, view } = renderInput({ placeholder: 'Search' })
    view.rerender(<InputSearch value="" onChange={() => {}} statusRef={statusRef} placeholder="Updating" />)

    expect(placeholders(root)).toHaveLength(2)
    act(() => { vi.advanceTimersByTime(CONNECTION_ANIMATION_DURATION) })
    expect(placeholders(root).map((n) => n.textContent)).toEqual(['Updating...'])
  })

  it('существующее место (MemberPicker из group/screens/shared) по-прежнему показывает плейсхолдер', () => {
    render(<MemberPicker title="GroupAddMembers" members={[]} onBack={() => {}} onPick={() => {}} />)
    const root = document.querySelector<HTMLElement>('.input-search')!
    // язык по умолчанию в тестовой среде — английский, `t('Search')` даёт ключ как есть
    expect(placeholders(root).map((n) => n.textContent)).toEqual(['Search'])
  })
})
