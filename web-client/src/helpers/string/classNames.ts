/**
 * Порт tweb `src/helpers/string/classNames.ts` — склейка списка классов с
 * отбрасыванием пустых.
 *
 * Тип аргументов ШИРЕ оригинального, и это вынужденно: у tweb объявлено
 * `...args: string[]`, но зовут его выражениями вида `!props.noRipple && 'rp'`
 * (`rippleElement.tsx:36-38`) и `props.noShadow && 'no-shadow'`
 * (`section.tsx:50`), то есть `string | false | undefined`. У tweb `strict`
 * выключен, и такой вызов проходит; у нас — нет, поэтому сузить тип до
 * `string[]` значило бы получить ошибку типов В КАЖДОЙ строке вызывающих.
 * Расширяем сигнатуру, а не правим вызывающих: правка вызывающих увела бы от
 * дословности сами портируемые компоненты.
 */
export default function classNames(...args: (string | false | undefined | null)[]) {
  return args.filter(Boolean).join(' ')
}
