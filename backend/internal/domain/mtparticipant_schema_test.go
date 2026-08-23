package domain

import (
	"sort"
	"testing"
	"time"
)

// Механическая сверка участников со схемой TL — тот же `schemaChecker`.
//
// Проверяется то, чего у подсистемы не было никогда: что РОЛЬ выражена выбором
// конструктора, а не строкой в записи, и что у каждого конструктора ровно те
// параметры, которые бывают у его роли (у обычного участника прав нет вовсе, у
// создателя нет даты вступления).

func participantCases() []struct {
	name  string
	value any
} {
	rights := Rights(AllRights)
	return []struct {
		name  string
		value any
	}{
		{"создатель", NewChannelParticipant(Member{UserID: 7, Role: RoleCreator, Rights: rights}, 0)},
		{"админ", NewChannelParticipant(Member{UserID: 8, Role: RoleAdmin, Rights: rights}, 1787334148)},
		{"участник", NewChannelParticipant(Member{UserID: 9, Role: RoleMember}, 1787334148)},
		{"подписчик канала", NewChannelParticipant(Member{UserID: 10, Role: RoleSubscriber}, 1787334148)},
		{"выгнан", NewChannelParticipantBanned(11, 7, 1787334148, AllMemberPerms, time.Time{}, true)},
		{"ограничен, но в чате", NewChannelParticipantBanned(12, 7, 1787334148, PermSendMessages, time.Unix(1787420548, 0), false)},
		{"список участников", NewChannelsChannelParticipants(2,
			[]ChannelParticipant{
				NewChannelParticipant(Member{UserID: 7, Role: RoleCreator, Rights: rights}, 0),
				NewChannelParticipant(Member{UserID: 9, Role: RoleMember}, 1787334148),
			},
			[]UserReal{{Underscore: UserTag, ID: 9, FirstName: "Аня", Status: NewUserStatusRecently(false)}})},
		{"пустой список", NewChannelsChannelParticipants(0, nil, nil)},
	}
}

func TestParticipants_MatchesSchema(t *testing.T) {
	for _, tc := range participantCases() {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				omittedOK:    OmittedWithoutSubject,
			}
			c.walk(roundTripJSON(t, tc.value), "participants")
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

// Роль — ВЫБОР КОНСТРУКТОРА. Пин держит именно соответствие, а не факт «что-то
// собралось»: подменённая ветка отдала бы валидный по схеме объект другой роли.
func TestParticipants_RoleIsAChoiceOfConstructor(t *testing.T) {
	cases := map[string]string{
		RoleCreator:    ChannelParticipantCreatorTag,
		RoleAdmin:      ChannelParticipantAdminTag,
		RoleMember:     ChannelParticipantTag,
		RoleSubscriber: ChannelParticipantTag,
	}
	for role, want := range cases {
		got := NewChannelParticipant(Member{UserID: 1, Role: role}, 0).Tag()
		if got != want {
			t.Errorf("роль %q дала конструктор %q, ожидался %q", role, got, want)
		}
	}
}

// «Выгнан» и «ограничен» — ОДИН конструктор, разница во флаге `left`. Прежде это
// были два разных списка с разной формой строки.
func TestParticipants_KickedAndRestrictedShareOneConstructor(t *testing.T) {
	kicked := NewChannelParticipantBanned(1, 2, 0, AllMemberPerms, time.Time{}, true)
	limited := NewChannelParticipantBanned(1, 2, 0, PermSendMessages, time.Time{}, false)

	if kicked.Tag() != limited.Tag() {
		t.Fatalf("разные конструкторы: %q и %q", kicked.Tag(), limited.Tag())
	}
	if !kicked.PFlags["left"] {
		t.Error("выгнанный без флага left")
	}
	// «В чате» — ОТСУТСТВИЕ ключа, а не false.
	if _, present := limited.PFlags["left"]; present {
		t.Error("у оставшегося в чате флаг left присутствует")
	}
}

// Присутствие живёт на карточке пользователя, а не на строке участника: два
// дома у одного факта — то, из-за чего он и разъезжался.
func TestParticipants_PresenceLivesOnTheUserCard(t *testing.T) {
	p := NewChannelParticipant(Member{UserID: 9, Role: RoleMember}, 1787334148)
	decoded, ok := roundTripJSON(t, p).(map[string]any)
	if !ok {
		t.Fatal("участник не разобрался в объект")
	}
	if _, has := decoded["status"]; has {
		t.Error("присутствие уехало на строке участника")
	}
}
