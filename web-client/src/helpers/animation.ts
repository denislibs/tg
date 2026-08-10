// Порт tweb `helpers/animation.ts` — 1:1 по логике; правки только под формат
// `.oxlintrc.json` этого репозитория: без `;` (чинится `oxlint --fix`),
// `AnimationInstanceKey = any` → `unknown` (используется только как identity-
// ключ Map/аргумент, `typescript/no-explicit-any`), `void` перед двумя fire-
// and-forget промисами (`typescript/no-floating-promises`; у обоих коллбэк уже
// синхронный, поведение не меняется) и `!` на двух `deferred.resolve()`
// (`CancellablePromise.resolve` опционален по типу — `strictNullChecks` у нас
// включён, в tweb выключен; `deferredPromise()` из `@helpers/cancellablePromise`
// всегда проставляет `resolve` до того, как инстанс становится наблюдаемым).
//
// Довезено как транзитивная зависимость `helpers/fastSmoothScroll.ts` (Задача 2
// довендоривает зависимости Scrollable/ScrollSaver) — в брифе явно не названа,
// но чиста (только `@helpers/schedulers` и `@helpers/cancellablePromise`, оба
// уже в репозитории/довозятся этой же задачей).
// * Jolly Cobra's animation.ts

import { fastRaf } from '@helpers/schedulers'
import deferredPromise, { CancellablePromise } from '@helpers/cancellablePromise'

interface AnimationInstance {
  isCancelled: boolean
  deferred: CancellablePromise<void>
}

type AnimationInstanceKey = unknown
const instances: Map<AnimationInstanceKey, AnimationInstance> = new Map()

export function createAnimationInstance(key: AnimationInstanceKey) {
  cancelAnimationByKey(key)

  const instance: AnimationInstance = {
    isCancelled: false,
    deferred: deferredPromise<void>(),
  }

  instances.set(key, instance)
  void instance.deferred.then(() => {
    if(getAnimationInstance(key) === instance) {
      instances.delete(key)
    }
  })

  return instance
}

export function getAnimationInstance(key: AnimationInstanceKey) {
  return instances.get(key)
}

export function cancelAnimationByKey(key: AnimationInstanceKey) {
  const instance = getAnimationInstance(key)
  if(instance) {
    instance.isCancelled = true
    instance.deferred.resolve!()
  }
}

export function animateSingle(tick: Function, key: AnimationInstanceKey, instance?: AnimationInstance) {
  if(!instance) {
    instance = createAnimationInstance(key)
  }

  fastRaf(() => {
    if(instance.isCancelled) {
      return
    }

    if(tick()) {
      void animateSingle(tick, key, instance)
    } else {
      instance.deferred.resolve!()
    }
  })

  return instance.deferred
}

export function animate(tick: Function) {
  fastRaf(() => {
    if(tick()) {
      animate(tick)
    }
  })
}
