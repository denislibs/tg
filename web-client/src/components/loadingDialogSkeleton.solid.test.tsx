/** @jsxImportSource solid-js */
// Пины Solid-порта tweb `src/components/loadingDialogSkeleton.tsx` (812502980) —
// `loadingDialogSkeleton.solid.tsx`. Сценарии перенесены с React-носителя
// `components/virtual/LoadingDialogSkeleton.test.tsx` (спека § 5: «тесты-
// предохранители переписываются, а не удаляются»); React-носитель снесён в 1-6.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'

import LoadingDialogSkeleton, { type LoadingDialogSkeletonSize } from './loadingDialogSkeleton.solid'
import s from './loadingDialogSkeleton.module.scss'

let disposers: (() => void)[] = []

afterEach(() => {
  for (const dispose of disposers) dispose()
  disposers = []
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function mount(props: { size: LoadingDialogSkeletonSize, seed: number, noAvatar?: boolean, class?: string }) {
  const host = document.createElement('div')
  document.body.append(host)
  const disposeRoot = render(() => <LoadingDialogSkeleton {...props} />, host)
  let disposed = false
  const dispose = () => {
    if(disposed) return
    disposed = true
    disposeRoot()
  }
  disposers.push(dispose)
  return { root: host.firstElementChild as HTMLElement, dispose }
}

// Та же формула, что и в компоненте (tweb `loadingDialogSkeleton.tsx:6-11`), —
// пересчитывается независимо, чтобы тест ловил и порчу диапазонов, и порчу формулы.
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

function widthsOf(root: HTMLElement) {
  const width = (cls: string) => (root.getElementsByClassName(cls)[0] as HTMLElement).style.getPropertyValue('--width')
  return {
    titleLeft: width(s.TitleLeft),
    titleRight: width(s.TitleRight),
    subtitle: width(s.Subtitle),
  }
}

describe('LoadingDialogSkeleton (Solid) — ширины плашек по seed (:6-11, :44-48)', () => {
  it('seed=0 и seed=7 дают ширины по формуле оригинала', () => {
    expect(widthsOf(mount({ size: 72, seed: 0 }).root)).toEqual(widthsFor(0))
    expect(widthsOf(mount({ size: 72, seed: 7 }).root)).toEqual(widthsFor(7))
  })

  it('разные seed дают разные ширины', () => {
    expect(widthsOf(mount({ size: 72, seed: 0 }).root)).not.toEqual(widthsOf(mount({ size: 72, seed: 7 }).root))
  })
})

describe('LoadingDialogSkeleton (Solid) — классы корня (:35-41)', () => {
  it('size=72 и size=64 дают свои классы размера', () => {
    const root72 = mount({ size: 72, seed: 0 }).root
    expect(root72.classList.contains(s.size72)).toBe(true)
    expect(root72.classList.contains(s.size64)).toBe(false)

    const root64 = mount({ size: 64, seed: 0 }).root
    expect(root64.classList.contains(s.size64)).toBe(true)
    expect(root64.classList.contains(s.size72)).toBe(false)
  })

  it('корень несёт Container и loading-dialog-skeleton (под него — правило collapsed-режима в _leftSidebar.scss)', () => {
    const root = mount({ size: 72, seed: 0 }).root
    expect(root.classList.contains(s.Container)).toBe(true)
    expect(root.classList.contains('loading-dialog-skeleton')).toBe(true)
  })

  it('noAvatar — класс noAvatar на корне, без него класса нет', () => {
    expect(mount({ size: 72, seed: 0 }).root.classList.contains(s.noAvatar)).toBe(false)
    expect(mount({ size: 72, seed: 0, noAvatar: true }).root.classList.contains(s.noAvatar)).toBe(true)
  })

  it('внешний class доезжает до корня (им ядро списка кладёт класс позиционирования)', () => {
    expect(mount({ size: 72, seed: 0, class: 'outer' }).root.classList.contains('outer')).toBe(true)
  })
})

describe('LoadingDialogSkeleton (Solid) — shimmer (:24-31)', () => {
  it('shimmer-класс появляется только через 1500 мс после монтирования', () => {
    vi.useFakeTimers()
    const root = mount({ size: 72, seed: 0 }).root

    expect(root.classList.contains(s.shimmer)).toBe(false)
    vi.advanceTimersByTime(1499)
    expect(root.classList.contains(s.shimmer)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(root.classList.contains(s.shimmer)).toBe(true)
  })

  it('снятие до 1500 мс снимает таймер — на снятом узле шиммер не включается', () => {
    vi.useFakeTimers()
    const { root, dispose } = mount({ size: 72, seed: 0 })

    dispose()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(2000)
    expect(root.classList.contains(s.shimmer)).toBe(false)
  })
})
