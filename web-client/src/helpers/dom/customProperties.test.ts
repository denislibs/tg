// Тесты порта tweb `helpers/dom/customProperties.ts`: имя — без `--` (класс
// добавляет префикс сам), значение кэшируется, `night` читается со скрытого
// элемента `.night`, кэш сбрасывается на `theme_changed` и `resize`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import customProperties from './customProperties'
import rootScope from '@lib/rootScope'
import mediaSizes from '@helpers/mediaSizes'

let style: HTMLStyleElement

function setStyle(css: string) {
  style.textContent = css
}

beforeEach(() => {
  style = document.createElement('style')
  document.head.append(style)
  // начисто: кэш синглтона не должен тянуться между тестами
  customProperties['cache'] = {}
  customProperties['computedStyle'] = undefined
  customProperties['nightComputedStyle'] = undefined
})

afterEach(() => {
  style.remove()
})

describe('customProperties', () => {
  it('getProperty берёт имя без `--` и читает переменную корня', () => {
    setStyle(':root { --surface-color: #112233; }')
    expect(customProperties.getProperty('surface-color')).toBe('#112233')
  })

  it('getProperty(night) читает переменную из-под `.night`', () => {
    setStyle(':root { --surface-color: #ffffff; } .night { --surface-color: #212121; }')
    expect(customProperties.getProperty('surface-color')).toBe('#ffffff')
    expect(customProperties.getProperty('surface-color', true)).toBe('#212121')
  })

  it('значение кэшируется до сброса', () => {
    setStyle(':root { --primary-color: #3390ec; }')
    expect(customProperties.getProperty('primary-color')).toBe('#3390ec')
    setStyle(':root { --primary-color: #ff0000; }')
    expect(customProperties.getProperty('primary-color')).toBe('#3390ec')
  })

  it('theme_changed сбрасывает кэш', () => {
    setStyle(':root { --primary-color: #3390ec; }')
    expect(customProperties.getProperty('primary-color')).toBe('#3390ec')
    setStyle(':root { --primary-color: #ff0000; }')
    rootScope.dispatchEvent('theme_changed')
    expect(customProperties.getProperty('primary-color')).toBe('#ff0000')
  })

  it('resize mediaSizes сбрасывает кэш', () => {
    setStyle(':root { --primary-color: #3390ec; }')
    expect(customProperties.getProperty('primary-color')).toBe('#3390ec')
    setStyle(':root { --primary-color: #00ff00; }')
    mediaSizes.dispatchEvent('resize')
    expect(customProperties.getProperty('primary-color')).toBe('#00ff00')
  })

  it('getPropertyAsColor: `#`-имя отдаёт как есть, hex — как есть, иначе rgb(…)', () => {
    setStyle(':root { --hex-color: #abcdef; --triplet-color: 1, 2, 3; }')
    expect(customProperties.getPropertyAsColor('#fff')).toBe('#fff')
    expect(customProperties.getPropertyAsColor('hex-color')).toBe('#abcdef')
    expect(customProperties.getPropertyAsColor('triplet-color')).toBe('rgb(1, 2, 3)')
  })
})
