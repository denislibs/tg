// ПОРТ 1:1 из tweb src/helpers/string/classNames.ts.
// Склейка классов с отбрасыванием пустых — для условных классов передавай
// `cond ? styles.x : ''` (идиома tweb).
export default function classNames(...args: string[]) {
  return args.filter(Boolean).join(' ')
}
