// Вендор из tweb `src/vendor/solid-transition-group/index.ts`, урезанный до
// `<Transition>` — см. докблок `common.ts` про то, почему `<TransitionGroup>`
// (и её зависимость `@vendor/createListTransition`) здесь не портированы:
// предмета (списковая анимация) в auth-флоу нет, довенднрить — когда появится
// первый настоящий потребитель.
export { Transition } from './transition'
export type { TransitionProps, TransitionEvents } from './transition'
