// Порт tweb chatBackground.tsx resolveTransition (усечённо: 'auto'-ветка — наша
// единственная: первый показ решается по кэшу, повторные — instant).
export function resolveTransition(args: { hadPrevious: boolean; cached: boolean }): 'instant' | 'fade' {
  if (args.hadPrevious) return 'instant'
  return args.cached ? 'instant' : 'fade'
}
