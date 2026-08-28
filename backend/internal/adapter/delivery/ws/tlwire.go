package ws

import (
	"encoding/json"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Кодирование кадра в TL на ВЫХОДЕ — ровно то место, ради которого кодек и
// печатался из схемы (решение Р8: журналы остаются в форме МОДЕЛИ, а провод
// собирается из неё же на выходе).
//
// Сюда приходит уже собранный JSON-кадр `{t, d, pts?}` — витрины строят его
// словарями, а до этой точки он доезжает байтами через Redis. Разбирать его
// обратно не расточительство, а следствие того, что публикация одна на всех
// получателей, а формат провода — свойство КОНКРЕТНОГО соединения.
//
// Кадр, у которого нет конструктора, здесь не кодируется вовсе и уезжает
// JSON-текстом. Таких два вида, и оба названы:
//
//   - ТРАНСПОРТНЫЕ (hello, pong, message_ack, message_error, хендшейк секретных
//     чатов, обёртки звонков) — решение Р6: апдейтами они не становятся;
//   - непортированные предметы (folder_update, истории, гео-трансляция) —
//     задачи #51/#52.
//
// Поэтому на проводе TL текстовый кадр значит «не апдейт», а бинарный —
// «контейнер Updates». Второго признака заводить не понадобилось.
func tlEncodeUpdateFrame(frame []byte) ([]byte, bool) {
	var env struct {
		D   json.RawMessage `json:"d"`
		Pts *int64          `json:"pts"`
	}
	if err := json.Unmarshal(frame, &env); err != nil || len(env.D) == 0 {
		return nil, false
	}
	var body map[string]any
	if err := json.Unmarshal(env.D, &body); err != nil {
		return nil, false
	}
	if _, ok := body["_"].(string); !ok {
		return nil, false // предмета в схеме нет — конструктора у кадра тоже
	}
	out, err := domain.WireCodec.Marshal(domain.NewUpdatesEnvelope(body, env.Pts, time.Now().Unix()))
	if err != nil {
		return nil, false
	}
	return out, true
}
