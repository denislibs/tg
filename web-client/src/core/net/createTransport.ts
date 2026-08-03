import type { Transport } from './transport'
import { WsClient } from './wsClient'
import { makeDnpTransport } from './dnp'
import { AppConfig } from '../../config/app'

// Точка выбора транспорта по флагу. Дефолт (OFF) → plain WS, поведение 1:1 с текущим.
export function createTransport(): Transport {
  return AppConfig.dnp.enabled ? makeDnpTransport() : new WsClient('/ws')
}
