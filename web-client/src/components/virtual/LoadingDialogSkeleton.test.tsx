// Тесты порта tweb loadingDialogSkeleton.tsx (см. LoadingDialogSkeleton.tsx —
// комментарий-ссылка на оригинал). Норма: строка проводки без теста, чья
// мутация краснеет, — нарушение (web-client/CLAUDE.md, «Тесты»).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import LoadingDialogSkeleton from './LoadingDialogSkeleton'
import s from './LoadingDialogSkeleton.module.scss'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// Та же формула, что и в компоненте (tweb loadingDialogSkeleton.tsx:6-11) —
// пересчитывается независимо, чтобы тест ловил и порчу диапазонов, и порчу
// самой формулы.
function pseudoRandomRange(seed: number, min: number, max: number): number {
  const x = Math.sin(seed * 10000 + 999999) * 10000
  const rand = x - Math.floor(x)
  return min + rand * (max - min)
}

function widthsFor(seed: number) {
  return {
    titleLeft: (pseudoRandomRange(seed, 100, 120) | 0) + 'px',
    titleRight: (pseudoRandomRange(seed, 20, 60) | 0) + 'px',
    subtitle: (pseudoRandomRange(seed, 60, 200) | 0) + 'px',
  }
}

function widthsOf(container: HTMLElement) {
  const titleLeft = container.getElementsByClassName(s.TitleLeft)[0] as HTMLElement
  const titleRight = container.getElementsByClassName(s.TitleRight)[0] as HTMLElement
  const subtitle = container.getElementsByClassName(s.Subtitle)[0] as HTMLElement
  return {
    titleLeft: titleLeft.style.getPropertyValue('--width'),
    titleRight: titleRight.style.getPropertyValue('--width'),
    subtitle: subtitle.style.getPropertyValue('--width'),
  }
}

describe('LoadingDialogSkeleton — ширины плашек по seed', () => {
  it('seed=0 даёт ширины по формуле оригинала', () => {
    const { container } = render(<LoadingDialogSkeleton size={72} seed={0} />)
    expect(widthsOf(container)).toEqual(widthsFor(0))
  })

  it('seed=7 даёт ширины по формуле оригинала', () => {
    const { container } = render(<LoadingDialogSkeleton size={72} seed={7} />)
    expect(widthsOf(container)).toEqual(widthsFor(7))
  })

  it('разные seed дают разные ширины', () => {
    const a = render(<LoadingDialogSkeleton size={72} seed={0} />)
    const widthsA = widthsOf(a.container)
    a.unmount()

    const b = render(<LoadingDialogSkeleton size={72} seed={7} />)
    const widthsB = widthsOf(b.container)

    expect(widthsA).not.toEqual(widthsB)
  })
})

describe('LoadingDialogSkeleton — размер', () => {
  it('size=72 и size=64 дают разные классы размера на корне', () => {
    const a = render(<LoadingDialogSkeleton size={72} seed={0} />)
    const root72 = a.container.firstElementChild as HTMLElement
    expect(root72.classList.contains(s.size72)).toBe(true)
    expect(root72.classList.contains(s.size64)).toBe(false)
    a.unmount()

    const b = render(<LoadingDialogSkeleton size={64} seed={0} />)
    const root64 = b.container.firstElementChild as HTMLElement
    expect(root64.classList.contains(s.size64)).toBe(true)
    expect(root64.classList.contains(s.size72)).toBe(false)
  })

  it('корень несёт класс loading-dialog-skeleton (под него — правило collapsed-режима в _leftSidebar.scss)', () => {
    const { container } = render(<LoadingDialogSkeleton size={72} seed={0} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.classList.contains('loading-dialog-skeleton')).toBe(true)
  })
})

describe('LoadingDialogSkeleton — noAvatar', () => {
  it('без noAvatar аватар виден (нет класса noAvatar)', () => {
    const { container } = render(<LoadingDialogSkeleton size={72} seed={0} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.classList.contains(s.noAvatar)).toBe(false)
  })

  it('noAvatar скрывает аватар классом noAvatar на корне', () => {
    const { container } = render(<LoadingDialogSkeleton size={72} seed={0} noAvatar />)
    const root = container.firstElementChild as HTMLElement
    expect(root.classList.contains(s.noAvatar)).toBe(true)
  })
})

describe('LoadingDialogSkeleton — shimmer', () => {
  it('shimmer-класс появляется только через 1500 мс после монтирования', () => {
    vi.useFakeTimers()
    const { container } = render(<LoadingDialogSkeleton size={72} seed={0} />)
    const root = container.firstElementChild as HTMLElement

    expect(root.classList.contains(s.shimmer)).toBe(false)

    act(() => { vi.advanceTimersByTime(1499) })
    expect(root.classList.contains(s.shimmer)).toBe(false)

    act(() => { vi.advanceTimersByTime(1) })
    expect(root.classList.contains(s.shimmer)).toBe(true)
  })

  it('размонтирование до 1500 мс снимает таймер (clearTimeout)', () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')

    const { unmount } = render(<LoadingDialogSkeleton size={72} seed={0} />)
    unmount()

    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
