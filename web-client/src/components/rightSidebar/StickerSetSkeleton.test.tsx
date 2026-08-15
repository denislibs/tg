import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import StickerSetSkeleton from './StickerSetSkeleton'

// Без явного cleanup между тестами DOM предыдущего render остаётся смонтированным
// (в проекте нет глобального afterEach-автоклинапа, см. другие *.test.tsx) —
// без этого второй тест ловит плитки первого вперемешку со своими.
afterEach(cleanup)

describe('StickerSetSkeleton', () => {
  it('рисует заданное число заглушек наборов', () => {
    render(<StickerSetSkeleton count={3} />)
    expect(screen.getAllByTestId('sticker-set-skeleton')).toHaveLength(3)
  })

  it('в каждой заглушке пять плиток — как превью набора в выдаче', () => {
    render(<StickerSetSkeleton count={1} />)
    expect(screen.getAllByTestId('sticker-set-skeleton-tile')).toHaveLength(5)
  })
})
