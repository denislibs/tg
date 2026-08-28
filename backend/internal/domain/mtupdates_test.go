package domain

import (
	"encoding/hex"
	"encoding/json"
	"testing"
)

// Тело кадра в том виде, в каком его видит выход WS: это JSON-дерево, а не
// типизированное значение (витрины строят кадры словарями, а публикуются они
// байтами через Redis).
func bodyOf(t *testing.T, v any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("тело кадра не маршалится: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("тело кадра не разбирается в дерево: %v", err)
	}
	return m
}

const envelopeDate int64 = 1787334148

// Оболочка выбирается по СХЕМЕ: курсор в конверте бывает ровно у тех кадров,
// чей конструктор `pts` не объявляет.
func TestUpdatesEnvelope_ShapeFollowsSchema(t *testing.T) {
	msg := MessageReal{Underscore: MessageTag, ID: 12, PeerID: NewPeerUser(7),
		Date: int(envelopeDate), Message: "привет"}

	withPts := NewUpdatesEnvelope(bodyOf(t, NewUpdateNewMessage(msg, 41)), nil, envelopeDate)
	if withPts["_"] != UpdateShortTag {
		t.Fatalf("кадр со своим pts обязан ехать updateShort, а не %v", withPts["_"])
	}

	seq := int64(42)
	withoutPts := NewUpdatesEnvelope(bodyOf(t, NewUpdateDialogPinned(NewPeerUser(7), true)), &seq, envelopeDate)
	if withoutPts["_"] != UpdatesTag {
		t.Fatalf("кадр без своего pts обязан ехать updates, а не %v", withoutPts["_"])
	}
	if withoutPts["seq"] != seq {
		t.Fatalf("курсор конверта обязан стать seq контейнера, а стал %v", withoutPts["seq"])
	}
}

// Эталонные байты обеих оболочек. Ту же строку разбирает порт `tl_utils` на
// клиенте (web-client/src/lib/mtproto/tlUtils.golden.test.ts) — круг сходится
// на той же паре, что поедет по проводу.
func TestUpdatesEnvelope_Golden(t *testing.T) {
	msg := MessageReal{Underscore: MessageTag, ID: 12, PeerID: NewPeerUser(7),
		Date: int(envelopeDate), Message: "привет"}
	seq := int64(42)

	cases := []struct {
		golden string
		value  map[string]any
	}{
		{"updateShortNewMessage", NewUpdatesEnvelope(bodyOf(t, NewUpdateNewMessage(msg, 41)), nil, envelopeDate)},
		{"updatesDialogPinned", NewUpdatesEnvelope(bodyOf(t, NewUpdateDialogPinned(NewPeerUser(7), true)), &seq, envelopeDate)},
	}

	for _, c := range cases {
		t.Run(c.golden, func(t *testing.T) {
			body, err := WireCodec.Marshal(c.value)
			if err != nil {
				t.Fatalf("кодек не собрал оболочку: %v", err)
			}
			if got, want := hex.EncodeToString(body), goldenHex(t, c.golden); got != want {
				t.Fatalf("байты оболочки разошлись с общим эталоном\n получили %s\n ожидали  %s", got, want)
			}
		})
	}
}
