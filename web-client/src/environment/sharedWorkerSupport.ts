// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
import Modes from '@config/modes';

const IS_SHARED_WORKER_SUPPORTED = typeof(SharedWorker) !== 'undefined' && !Modes.noSharedWorker/*  && false */;

export default IS_SHARED_WORKER_SUPPORTED;