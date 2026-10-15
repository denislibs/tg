package domain

import (
	"encoding/json"
	"testing"
)

// VA2-03 / A4-13: идущий видеочат или эфир едет флагами channel.call_active и
// call_not_empty во ВСЕХ трёх сборщиках `channel`. Клиент оригинала заменяет
// лежащий канал целиком вместе с pFlags (tweb appChatsManager.saveApiChat), и
// сборщик без флагов гасил иконку звонка в списке и плашку в шапке.
func TestToChannel_CallFlags(t *testing.T) {
	call := CallState{Active: true, NotEmpty: true}

	rec := ChatRecord{ID: 5, Type: ChatTypeGroup, Title: "Г", ViewerID: 7, MyRole: RoleMember, Call: call}
	if ch := rec.ToChannel(); !ch.PFlags["call_active"] || !ch.PFlags["call_not_empty"] {
		t.Fatalf("карточка: pFlags = %v, ждали call_active и call_not_empty", ch.PFlags)
	}
	// Снимок chat_update без зрителя — min, но звонок общий для чата.
	snap := ChatRecord{ID: 5, Type: ChatTypeChannel, Title: "К", Call: call}
	if ch := snap.ToChannel(); !ch.PFlags["min"] || !ch.PFlags["call_active"] || !ch.PFlags["call_not_empty"] {
		t.Fatalf("снимок без зрителя: pFlags = %v, ждали min + флаги звонка", ch.PFlags)
	}
	dlg := DialogRecord{ChatID: 5, Type: ChatTypeGroup, Title: "Г", MyRole: RoleMember, Call: call}
	if ch := dlg.ToChannel(); !ch.PFlags["call_active"] || !ch.PFlags["call_not_empty"] {
		t.Fatalf("строка списка: pFlags = %v, ждали call_active и call_not_empty", ch.PFlags)
	}

	// Без звонка ключей нет вовсе.
	rec.Call = CallState{}
	dlg.Call = CallState{}
	for name, ch := range map[string]Channel{"карточка": rec.ToChannel(), "список": dlg.ToChannel()} {
		if _, ok := ch.PFlags["call_active"]; ok {
			t.Fatalf("%s без звонка несёт call_active: %v", name, ch.PFlags)
		}
		if _, ok := ch.PFlags["call_not_empty"]; ok {
			t.Fatalf("%s без звонка несёт call_not_empty: %v", name, ch.PFlags)
		}
	}
}

// Чат, который зрителю не читается, звонка не показывает: честный min несёт
// только общие свойства чата (имя, вид), а не состояние закрытых комнат.
func TestToChannel_HiddenCarriesNoCall(t *testing.T) {
	rec := ChatRecord{ID: 5, Type: ChatTypeGroup, Title: "Чужая", ViewerID: 8, Hidden: true,
		Call: CallState{Active: true, NotEmpty: true}}
	if ch := rec.ToChannel(); ch.PFlags["call_active"] || ch.PFlags["call_not_empty"] {
		t.Fatalf("min нечитаемого чата несёт звонок: %v", ch.PFlags)
	}
}

// keepPFlags на разборе пропускает только объявленные флаги: без имён в
// channelFlagNames круг «собрал → записал в журнал → прочитал» терял бы их.
func TestChannel_CallFlagsSurviveJSONRoundTrip(t *testing.T) {
	src := NewChannel(5, "Г", nil, ChatRecord{}.CreatedAt, ChannelFlags{Megagroup: true, CallActive: true, CallNotEmpty: true})
	raw, err := json.Marshal(src)
	if err != nil {
		t.Fatal(err)
	}
	var back Channel
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	if !back.PFlags["call_active"] || !back.PFlags["call_not_empty"] {
		t.Fatalf("после разбора pFlags = %v", back.PFlags)
	}
}
