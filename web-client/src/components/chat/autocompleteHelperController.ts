// Порт tweb `src/components/chat/autocompleteHelperController.ts` (812502980) 1:1 —
// реестр хелперов автокомплита одной строки ввода: каскад скрытия и навигация
// по списку. Пачка П-6, Б-34.
import { getMiddleware } from '@helpers/middleware'
import type AutocompleteHelper from './autocompleteHelper'

export default class AutocompleteHelperController {
  private helpers: Set<AutocompleteHelper> = new Set()
  private middleware = getMiddleware()

  public toggleListNavigation(enabled: boolean) {
    for(const helper of this.helpers) {
      helper.toggleListNavigation(enabled)
    }
  }

  public destroy() {
    this.middleware.destroy()
    this.hideOtherHelpers()
  }

  public getMiddleware() {
    this.middleware.clean()
    return this.middleware.get()
  }

  public addHelper(helper: AutocompleteHelper) {
    this.helpers.add(helper)
  }

  public hideOtherHelpers(
    preserveHelpers?: Set<AutocompleteHelper>,
    skipAnimation = false,
  ) {
    this.helpers.forEach((helper) => {
      if(!preserveHelpers?.has(helper)) {
        helper.toggle(true, true, skipAnimation)
      }
    })

    if(!preserveHelpers?.size) {
      this.middleware.clean()
    }
  }
}
