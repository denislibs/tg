import { createWorkerCore } from './workerCore'
export type { WorkerRegistry } from './workerCore'

const core = createWorkerCore()
core.start()
