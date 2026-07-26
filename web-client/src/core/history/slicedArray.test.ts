import { describe, it, expect } from 'vitest'
import SlicedArray, { SliceEnd } from './slicedArray'

describe('SlicedArray (descending seqs)', () => {
  it('insertSlice stores descending and reports length', () => {
    const sa = new SlicedArray<number>()
    sa.insertSlice([5, 4, 3]) // newest-first
    expect(Array.from(sa.first)).toEqual([5, 4, 3])
    expect(sa.length).toBe(3)
  })

  it('merges an overlapping older slice into one', () => {
    const sa = new SlicedArray<number>()
    sa.insertSlice([5, 4, 3])
    sa.insertSlice([3, 2, 1]) // overlaps at 3
    expect(Array.from(sa.first)).toEqual([5, 4, 3, 2, 1])
    expect(sa.slices.length).toBe(1)
  })

  it('keeps disjoint ranges as separate slices', () => {
    const sa = new SlicedArray<number>()
    sa.insertSlice([10, 9])
    sa.insertSlice([3, 2])
    expect(sa.slices.length).toBe(2)
  })

  it('sliceMe returns a window from the newest end when offsetId=0 and Bottom is set', () => {
    const sa = new SlicedArray<number>()
    const first = sa.insertSlice([5, 4, 3, 2, 1])!
    first.setEnd(SliceEnd.Bottom)
    const r = sa.sliceMe(0, 0, 2)
    expect(r).toBeDefined()
    expect(Array.from(r!.slice)).toEqual([5, 4])
  })

  it('sliceMe reports Top fulfilled at the top end', () => {
    const sa = new SlicedArray<number>()
    const first = sa.insertSlice([5, 4, 3, 2, 1])!
    first.setEnd(SliceEnd.Both)
    const r = sa.sliceMe(2, 1, 40) // older inclusive of seq 2
    expect(r).toBeDefined()
    expect((r!.fulfilled & SliceEnd.Top) === SliceEnd.Top).toBe(true)
  })

  it('serializes and restores ends via toJSON/fromJSON', () => {
    const sa = new SlicedArray<number>()
    const first = sa.insertSlice([3, 2, 1])!
    first.setEnd(SliceEnd.Both)
    const restored = SlicedArray.fromJSON<number>(sa.toJSON())
    expect(Array.from(restored.first)).toEqual([3, 2, 1])
    expect(restored.first.getEnds().both).toBe(true)
  })
})
