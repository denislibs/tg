import type { Transport } from './transport'
import { WsClient } from './wsClient'
import { makeDnpTransport } from './dnp'
import { AppConfig } from '../../config/app'

// Точка выбора транспорта по флагу. Дефолт (OFF) → plain WS, поведение 1:1 с текущим.
//
// Флага здесь два, и они про РАЗНОЕ: dnp — про канал (шифрование поверх WSS),
// tlWire — про формат кадров внутри него. Провод TL пока умеет только plain-WS:
// у DNP свой kind-байт, и выбор формата внутри канала — отдельный разговор
// (задача #54).
export function createTransport(): Transport {
  return AppConfig.dnp.enabled ? makeDnpTransport() : new WsClient('/ws', AppConfig.tlWire)
}
