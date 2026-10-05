// Порт tweb `src/components/chat/hideCommandAutocomplete.ts` (812502980) 1:1.
import type AutocompleteHelperController from './autocompleteHelperController'

export default function hideCommandAutocomplete(
  controller: AutocompleteHelperController,
) {
  controller.hideOtherHelpers(undefined, true)
}
