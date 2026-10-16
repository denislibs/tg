// Порт tweb `helpers/dom/customProperties.ts` (812502980) 1:1: имя — без `--` (префикс добавляет
// getProperty), кэш по [день, ночь], скрытый `.night`-элемент, сброс на theme_changed и resize.
//
// Расхождения с оригиналом:
//  1. `CustomProperty` — строка: у оригинала это объединение имён переменных темы
//     (`AppColorName` и соседи), у нас такого перечня нет.
//  2. `getPropertyAsSize` (:62-75) не перенесён: у оригинала его единственный
//     вызов закомментирован (`emoticonsDropdown/tab.ts:256`), у нас вызывающих нет.
import { MOUNT_CLASS_TO } from '@config/debug'
import rootScope from '@lib/rootScope'
import mediaSizes from '@helpers/mediaSizes'

export type CustomProperty = string

export class CustomProperties {
  private cache: { [k in CustomProperty]?: [string, string] }
  private computedStyle: CSSStyleDeclaration | undefined
  private nightComputedStyle: CSSStyleDeclaration | undefined
  private nightElement: HTMLElement

  constructor() {
    this.cache = {}

    this.nightElement = document.createElement('div')
    this.nightElement.className = 'night'
    this.nightElement.style.display = 'none'
    document.body.append(this.nightElement)

    rootScope.addEventListener('theme_changed', this.resetCache)
    mediaSizes.addEventListener('resize', this.resetCache)
  }

  protected resetCache = () => {
    this.computedStyle = undefined
    const cache = this.cache
    this.cache = {}

    for(const i in cache) {
      this.getProperty(i)
    }
  }

  public getProperty(name: CustomProperty, night?: boolean): string {
    const values = this.cache[name]
    const index = night ? 1 : 0
    if(values?.[index]) {
      return values[index]
    }

    this.computedStyle ??= window.getComputedStyle(document.documentElement)
    this.nightComputedStyle ??= window.getComputedStyle(this.nightElement)

    const value = (night ? this.nightComputedStyle : this.computedStyle).getPropertyValue('--' + name).trim()
    return this.setPropertyCache(name, value, night)
  }

  public getPropertyAsColor(name: CustomProperty): string {
    if(name[0] === '#') {
      return name
    }

    const value = this.getProperty(name)
    if(value[0] === '#') {
      return value
    }

    return `rgb(${value})`
  }

  public setPropertyCache(name: CustomProperty, value: string, night?: boolean): string {
    return (this.cache[name] ??= ['', ''])[night ? 1 : 0] = value
  }
}

const customProperties = new CustomProperties()
if(MOUNT_CLASS_TO) MOUNT_CLASS_TO.customProperties = customProperties
export default customProperties
