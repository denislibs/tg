// src/helpers/dom/superIntersectionObserver.ts
//
// Порт tweb `src/helpers/dom/superIntersectionObserver.ts` — МУЛЬТИПЛЕКСОР
// пересечений: ОДИН нативный `IntersectionObserver` раздаёт свои записи
// нескольким независимым колбэкам, каждый со своим набором наблюдаемых узлов.
//
// Зачем он вообще нужен, видно на ленте: у неё несколько разных вопросов «что
// сейчас видно» — непрочитанные баблы, просмотры постов канала, метрики
// чтения, эффекты стикера, подсказка guest-chat (tweb bubbles.ts:2127 и семь
// колбэков вокруг). Наблюдатель у всех них ОДИН И ТОТ ЖЕ (корень —
// скролл-контейнер ленты, порог по умолчанию), а различаются только цели и
// реакция. Заведи каждому свой `IntersectionObserver` — и на каждый бабл
// пришлось бы по N наблюдений вместо одного, а `unobserve` одного потребителя
// снимал бы наблюдение и у остальных.
//
// ─── Что НЕ портировано и почему ────────────────────────────────────────────
//  • `toggleObservingNew`/`observingQueue` (заморозка новых наблюдений на время
//    тяжёлой анимации, tweb :52-78). У оригинала её включает
//    `apiManagerProxy`/лента вокруг «лесенки» появления баблов, которой у нас
//    ещё нет (долг записан в web-client/CLAUDE.md).
//  • `getIntersecting`/`intersecting` (:41-43) — набор «что сейчас пересекает».
//    Читателя нет ни одного: у оригинала им пользуется `animationIntersector`,
//    а у нас он свой (`components/animationIntersector.ts`) и на этом
//    мультиплексоре не стоит.
//  • `reobserve` (:100-112) — принудительная переотдача записи; у оригинала
//    нужна эффектам сообщения, которых у нас нет.
// Каждый из трёх заведётся вместе со своим потребителем, а не «на будущее».

export type IntersectionTarget = Element
export type IntersectionCallback = (entry: IntersectionObserverEntry) => void

export default class SuperIntersectionObserver {
  private observing = new Map<IntersectionTarget, Set<IntersectionCallback>>()
  private observer: IntersectionObserver

  constructor(init?: IntersectionObserverInit) {
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const callbacks = this.observing.get(entry.target)
        if (!callbacks) continue
        // Обход самого набора, без копии, — как в оригинале (tweb :30-38).
        // Колбэк вправе снять наблюдение прямо из себя (так устроен одноразовый
        // наблюдатель просмотров, tweb bubbles.ts:2308), и это законно: удаление
        // УЖЕ ПОСЕЩЁННОГО элемента `Set` по ходу `for…of` спецификацией
        // определено.
        for (const callback of callbacks) callback(entry)
      }
    }, init)
  }

  /** Наблюдать `target` ЭТИМ колбэком. Нативное наблюдение заводится один раз
   *  на узел — сколько бы колбэков на нём ни висело (tweb :80-98). */
  public observe(target: IntersectionTarget, callback: IntersectionCallback): void {
    let callbacks = this.observing.get(target)
    if (!callbacks) {
      callbacks = new Set()
      this.observing.set(target, callbacks)
      this.observer.observe(target)
    }
    callbacks.add(callback)
  }

  /** Снять ЭТОТ колбэк с узла; нативное наблюдение уходит вместе с ПОСЛЕДНИМ
   *  (tweb :114-127) — иначе один потребитель ослеплял бы остальных. */
  public unobserve(target: IntersectionTarget, callback: IntersectionCallback): void {
    const callbacks = this.observing.get(target)
    if (!callbacks) return
    callbacks.delete(callback)
    if (callbacks.size) return
    this.observing.delete(target)
    this.observer.unobserve(target)
  }

  /** Забыть ВСЁ наблюдаемое. Сам объект остаётся живым — наблюдать им дальше
   *  можно (tweb :45-50, тем же свойством пользуется `cleanup()` ленты). */
  public disconnect(): void {
    this.observing.clear()
    this.observer.disconnect()
  }
}
