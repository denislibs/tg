// Task 7 fix — покрываем 4 находки ревью (см. task-7-report.md): механика
// fade-in должна воспроизводить tweb avatarNew.tsx:549-604, а не буквальный
// снимок из плана («класс fade-in при монтировании»). Ревизия f59c800
// вешала `fade-in` в className сразу и снимала его по `animationend`; все
// тесты ниже написаны так, чтобы падать на f59c800 (см. отчёт — доказательство
// red-on-revert).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import Avatar from './Avatar'

function getPhotoImg() {
  return document.querySelector<HTMLImageElement>('img.avatar-photo')
}

afterEach(() => {
  cleanup()
  document.body.classList.remove('animation-level-0')
  vi.useRealTimers()
})

describe('Avatar: fade-in фотографии — механика tweb avatarNew.tsx', () => {
  it('находка 1: анимация не стартует раньше готовности картинки — до onLoad нет .fade-in, картинка скрыта', () => {
    render(<Avatar background="#000" src="/media/1/content" />)
    const img = getPhotoImg()
    expect(img).toBeTruthy()
    // f59c800: className="avatar-photo fade-in" ставился безусловно при монтировании —
    // этот expect ловит именно это (упал бы: fade-in уже есть до какой-либо загрузки).
    expect(img!.classList.contains('fade-in')).toBe(false)
    expect(img!.style.opacity).toBe('0')
  })

  it('готовность (onLoad) одновременно показывает картинку и включает fade-in', () => {
    render(<Avatar background="#000" src="/media/1/content" />)
    const img = getPhotoImg()!
    fireEvent.load(img)
    expect(img.classList.contains('fade-in')).toBe(true)
    expect(img.style.opacity).toBe('')
  })

  it('находка 2: кэшированное фото (img.complete && naturalWidth>0 сразу после монтирования) — без fade-in', () => {
    // Браузерный аналог tweb `cached = !(result instanceof Promise)`: байты уже
    // декодированы к моменту монтирования — эмулируем через naturalWidth, т.к.
    // happy-dom не грузит реальные картинки (complete у него константно true).
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth')
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 40 })
    try {
      render(<Avatar background="#000" src="/media/1/content" />)
      const img = getPhotoImg()!
      // f59c800 не гейтил cached вообще — fade-in ставился всегда, этот expect бы упал.
      expect(img.classList.contains('fade-in')).toBe(false)
      expect(img.style.opacity).toBe('')
    } finally {
      if (descriptor) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', descriptor)
    }
  })

  it('находка 3: animation-level-0 — onLoad не добавляет fade-in, картинка сразу видима', () => {
    document.body.classList.add('animation-level-0')
    render(<Avatar background="#000" src="/media/1/content" />)
    const img = getPhotoImg()!
    fireEvent.load(img)
    // f59c800 не проверял animation-level-0 — fade-in оказался бы включён, expect бы упал.
    expect(img.classList.contains('fade-in')).toBe(false)
    expect(img.style.opacity).toBe('')
  })

  it('fade-in снимается через FADE_IN_DURATION=200мс (tweb avatarNew.tsx:600 — setTimeout, не animationend)', () => {
    vi.useFakeTimers()
    render(<Avatar background="#000" src="/media/1/content" />)
    const img = getPhotoImg()!
    fireEvent.load(img)
    expect(img.classList.contains('fade-in')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(img.classList.contains('fade-in')).toBe(false)
  })

  it('находка 4: повторная смена src на том же инстансе Avatar снова даёт полный цикл fade-in', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Avatar background="#000" src="/media/1/content" />)
    let img = getPhotoImg()!
    fireEvent.load(img)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(img.classList.contains('fade-in')).toBe(false)

    rerender(<Avatar background="#000" src="/media/2/content" />)
    img = getPhotoImg()!
    // f59c800: className — статический литерал, classList.remove('fade-in') императивно
    // менял DOM в обход React → при смене только src React ничего не перезаписывал,
    // и повторная загрузка проходила БЕЗ fade-in. Здесь новый src обязан снова
    // скрыть картинку и сбросить fade-in до готовности.
    expect(img.classList.contains('fade-in')).toBe(false)
    expect(img.style.opacity).toBe('0')

    fireEvent.load(img)
    expect(img.classList.contains('fade-in')).toBe(true)
  })

  it('находка ревью (финальная зачистка): onError переводит фазу в явный error, а не оставляет вечный pending', () => {
    render(<Avatar background="#000" src="/media/1/content" />)
    const img = getPhotoImg()!
    expect(img.dataset.photoPhase).toBe('pending') // до события

    fireEvent.error(img)

    // Без onError-обработчика фаза осталась бы 'pending' навсегда — этот expect
    // ловит именно отсутствие перехода (без фикса упал бы: phase так и 'pending').
    // Визуально ничего не меняется (opacity: 0 и там, и там — под картинкой
    // градиентная подложка `.avatar`), но состояние теперь явное, а не совпадение.
    expect(img.dataset.photoPhase).toBe('error')
    expect(img.classList.contains('fade-in')).toBe(false)
    expect(img.style.opacity).toBe('0')
  })
})

// Task 9 (медиа-суперпорт): слой stripped-превью аватарки — 1:1 tweb
// avatarNew.tsx:574-590 (img КАК ЕСТЬ, без блюра, классы
// `avatar-photo avatar-photo-thumbnail`, под полной картинкой) и :598-604
// (снимается вместе с fade-in после загрузки полной).
describe('Avatar: слой avatar_preview (stripped-превью)', () => {
  function getThumb() {
    return document.querySelector<HTMLImageElement>('img.avatar-photo-thumbnail')
  }
  function getFull() {
    return document.querySelector<HTMLImageElement>('img.avatar-photo:not(.avatar-photo-thumbnail)')
  }

  it('при наличии preview рендерится thumbnail-слой: raw <img> с data-URI, БЕЗ блюра/канваса, под полной картинкой; корень несёт avatar-relative', () => {
    const { container } = render(<Avatar background="#000" src="/media/1/content" preview="QUJD" />)
    const thumb = getThumb()!
    expect(thumb).toBeTruthy()
    expect(thumb.src).toBe('data:image/jpeg;base64,QUJD')
    // КАК ЕСТЬ: превью аватарки не блюрится (в отличие от медиабаблов) — это
    // обычный <img>, никакого canvas и CSS-фильтра
    expect(thumb.tagName).toBe('IMG')
    expect(thumb.style.filter).toBe('')
    expect(container.querySelector('canvas')).toBeNull()
    // слой лежит ПОД полной картинкой (раньше в DOM)
    const full = getFull()!
    expect(thumb.nextElementSibling).toBe(full)
    // корень стакает слои классом avatar-relative (tweb avatarNew.tsx:1003)
    expect(container.querySelector('.avatar')!.classList.contains('avatar-relative')).toBe(true)
  })

  it('после onLoad полной картинки превью снимается фазовым механизмом (вместе с fade-in, через 200мс)', () => {
    vi.useFakeTimers()
    const { container } = render(<Avatar background="#000" src="/media/1/content" preview="QUJD" />)
    fireEvent.load(getFull()!)
    // пока играет fade-in — превью ещё видно (tweb: setThumb() в том же
    // setTimeout(FADE_IN_DURATION), что снимает fade-in)
    expect(getThumb()).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(getThumb()).toBeNull()
    expect(container.querySelector('.avatar')!.classList.contains('avatar-relative')).toBe(false)
  })

  it('ошибка загрузки полной — превью остаётся (в tweb setThumb() при ошибке не зовётся)', () => {
    render(<Avatar background="#000" src="/media/1/content" preview="QUJD" />)
    fireEvent.error(getFull()!)
    expect(getThumb()).toBeTruthy()
  })

  it('без preview слой не рендерится', () => {
    render(<Avatar background="#000" src="/media/1/content" />)
    expect(getThumb()).toBeNull()
  })
})
