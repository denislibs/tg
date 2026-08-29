// Порт tweb `helpers/dom/cancelEvent.ts` — 1:1 по логике; правки только под
// формат `.oxlintrc.json` этого репозитория: без `;` (чинится `oxlint --fix`)
// и `catch {}` вместо `catch(err) {}` (неиспользуемый параметр — `eslint/no-unused-vars`).
// Плюс `!` на четырёх обращениях к `event` после `@ts-ignore`-переприсваивания
// (`event = event.originalEvent || event` — `originalEvent` не объявлено на
// `Event`, поэтому TS теряет сужение из `if(event)` и после этой строки видит
// `event` снова как `Event | undefined`, хотя по рантайму он гарантированно
// определён — `strictNullChecks` у нас включён, в tweb выключен, см. tsconfig).
// `if(event.stopPropagation) event.stopPropagation()` — фичедетект под очень
// старые окружения (webogram-наследие, см. копирайт ниже) — убран: по нашим
// DOM-типам `stopPropagation`/`preventDefault` не опциональны, TS считает
// условие всегда истинным (`TS2774`, ошибка компиляции), а наш `vite.config.ts`
// и так собирает только под вечнозелёные браузеры (см. комментарий `build.target`).
/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

export default function cancelEvent(event?: Event) {
  event ||= window.event
  if(event) {
    // 'input' event will have cancelable=false, but we still need to preventDefault
    // if(!event.cancelable) {
    //   return false;
    // }

    // @ts-ignore
    event = event.originalEvent || event

    try {
      event!.stopPropagation()
      event!.preventDefault()
      event!.returnValue = false
      // tweb здесь пишет ещё `event.cancelBubble = true` — по спецификации
      // DOM это ровно `stopPropagation()` (старый алиас), которая уже
      // вызвана строкой выше; строка ничего не добавляла и в оригинале, а
      // в happy-dom (`cancelBubble` там объявлен только геттером) ещё и
      // бросала бы `TypeError` — тихо, `catch {}` его глотал, но строка не
      // делала того, что задумана. Убрана, а не продублирована.
    } catch {}
  }

  return false
}
