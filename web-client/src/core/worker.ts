import { createWorkerCore } from './workerCore'
export type { WorkerRegistry } from './workerCore'

// Точка входа воркера (CLAUDE.md «Тесты»): не импортируется тестами (это модуль
// SharedWorker/Worker, а не библиотечный код) — эти две строки физически нельзя
// вызвать из vitest тем же путём, каким их вызывает браузер (создание/монтирование
// самого воркера). Вся проводка, которую они запускают (createWorkerCore().bind,
// registerManagers, onAny/setOnPortDisconnect), покрыта поведенческими тестами
// через сами функции — workerCore.test.ts (bind()) и C-1 (start()) — вызывая их
// напрямую, без создания настоящего воркера. Сам факт «модуль исполняет обе
// строки на импорте» тестом не покрыт и не может быть — здесь нечего утверждать
// сверх текста.
const core = createWorkerCore()
core.start()
