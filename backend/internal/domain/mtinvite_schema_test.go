package domain

import (
	"sort"
	"testing"
	"time"
)

// Механическая сверка ссылок-приглашений и импортёров со схемой TL.
//
// Проверяется то, чего у подсистемы не было: что адрес ссылки ОДИН
// (параметр `link`, а не пара token+url), что признаки живут в `pFlags`, и что
// «вошёл» и «ждёт одобрения» — один конструктор с флагом, а не два списка.

func inviteCases() []struct {
	name  string
	value any
} {
	limit := 25
	expires := time.Unix(1787420548, 0)
	link := InviteLink{
		Token: "abc", CreatedBy: 7, Uses: 3, Title: "Для друзей",
		UsageLimit: &limit, ExpiresAt: &expires, RequiresApproval: true,
		CreatedAt: time.Unix(1787334148, 0),
	}
	return []struct {
		name  string
		value any
	}{
		{"ссылка целиком", NewChatInviteExported(link)},
		{"ссылка без срока и лимита", NewChatInviteExported(InviteLink{Token: "b", CreatedBy: 7, CreatedAt: time.Unix(1, 0)})},
		{"отозванная", NewChatInviteExported(InviteLink{Token: "c", CreatedBy: 7, Revoked: true, CreatedAt: time.Unix(1, 0)})},
		{"ответ создания", NewMessagesExportedChatInvite(link)},
		{"список ссылок", NewMessagesExportedChatInvites([]InviteLink{link})},
		{"вошёл по ссылке", NewChatInviteImporter(9, time.Unix(1787334148, 0), false, 0)},
		{"ждёт одобрения", NewChatInviteImporter(9, time.Unix(1787334148, 0), true, 0)},
		{"список импортёров", NewMessagesChatInviteImporters(1,
			[]ChatInviteImporter{NewChatInviteImporter(9, time.Unix(1, 0), false, 7)}, nil)},
	}
}

func TestInvites_MatchesSchema(t *testing.T) {
	for _, tc := range inviteCases() {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				omittedOK:    OmittedWithoutSubject,
			}
			c.walk(roundTripJSON(t, tc.value), "invites")
			sort.Strings(c.unexpected)
			sort.Strings(c.omitted)
			for _, s := range c.unexpected {
				t.Errorf("лишнее: %s", s)
			}
			for _, s := range c.omitted {
				t.Errorf("пропущено: %s", s)
			}
		})
	}
}

// Адрес ссылки ОДИН. Прежде он ехал дважды: токеном и собранной из него
// строкой — второе имя того же значения.
func TestInvites_AddressIsASingleLink(t *testing.T) {
	decoded, ok := roundTripJSON(t, NewChatInviteExported(InviteLink{Token: "abc", CreatedBy: 7})).(map[string]any)
	if !ok {
		t.Fatal("ссылка не разобралась в объект")
	}
	if decoded["link"] != "/join/abc" {
		t.Errorf("link = %v", decoded["link"])
	}
	if _, has := decoded["token"]; has {
		t.Error("токен уехал рядом со ссылкой — второе имя одного адреса")
	}
	if _, has := decoded["url"]; has {
		t.Error("url уехал рядом со ссылкой")
	}
}

// «Выключено» — ОТСУТСТВИЕ ключа в pFlags, а не false.
func TestInvites_FlagsAreAbsentWhenOff(t *testing.T) {
	off := NewChatInviteExported(InviteLink{Token: "a", CreatedBy: 1})
	if _, has := off.PFlags["revoked"]; has {
		t.Error("невыставленный revoked присутствует в pFlags")
	}
	on := NewChatInviteExported(InviteLink{Token: "a", CreatedBy: 1, Revoked: true, RequiresApproval: true})
	if !on.PFlags["revoked"] || !on.PFlags["request_needed"] {
		t.Errorf("выставленные флаги потерялись: %+v", on.PFlags)
	}
}

// Вошедший и ждущий одобрения — ОДИН конструктор, разницу выражает флаг.
func TestInvites_JoinedAndRequestedShareOneConstructor(t *testing.T) {
	joined := NewChatInviteImporter(9, time.Unix(1, 0), false, 0)
	requested := NewChatInviteImporter(9, time.Unix(1, 0), true, 0)
	if joined.Tag() != requested.Tag() {
		t.Fatalf("разные конструкторы: %q и %q", joined.Tag(), requested.Tag())
	}
	if _, has := joined.PFlags["requested"]; has {
		t.Error("у вошедшего флаг requested присутствует")
	}
	if !requested.PFlags["requested"] {
		t.Error("у заявки нет флага requested")
	}
}
