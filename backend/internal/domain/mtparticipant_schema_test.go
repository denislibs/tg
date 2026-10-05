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
	joined := time.Unix(1787334148, 0)
	stranger := ParticipantViewer{ID: 99}
	return []struct {
		name  string
		value any
	}{
		{"создатель", NewChannelParticipant(Member{UserID: 7, Role: RoleCreator, Rights: rights, Rank: "основатель"}, stranger)},
		{"админ", NewChannelParticipant(Member{UserID: 8, Role: RoleAdmin, Rights: rights, PromotedBy: 7, JoinedAt: joined}, stranger)},
		{"админ, назначенный зрителем", NewChannelParticipant(Member{UserID: 8, Role: RoleAdmin, Rights: rights, PromotedBy: 99, JoinedAt: joined, Rank: "мод"}, stranger)},
		{"админ — сам зритель", NewChannelParticipant(Member{UserID: 99, Role: RoleAdmin, Rights: rights, PromotedBy: 7, InviterID: 7, JoinedAt: joined}, stranger)},
		{"участник", NewChannelParticipant(Member{UserID: 9, Role: RoleMember, JoinedAt: joined}, stranger)},
		{"участник — сам зритель", NewChannelParticipant(Member{UserID: 99, Role: RoleMember, JoinedAt: joined, ViaRequest: true}, stranger)},
		{"подписчик канала", NewChannelParticipant(Member{UserID: 10, Role: RoleSubscriber, JoinedAt: joined}, stranger)},
		{"ушёл", NewChannelParticipantLeft(10)},
		{"выгнан", NewChannelParticipantBanned(11, 7, 1787334148, AllMemberPerms, time.Time{}, true)},
		{"ограничен, но в чате", NewChannelParticipantBanned(12, 7, 1787334148, PermSendMessages, time.Unix(1787420548, 0), false)},
		{"список участников", NewChannelsChannelParticipants(2,
			[]ChannelParticipant{
				NewChannelParticipant(Member{UserID: 7, Role: RoleCreator, Rights: rights}, stranger),
				NewChannelParticipant(Member{UserID: 9, Role: RoleMember, JoinedAt: joined}, stranger),
			},
			[]UserReal{{Underscore: UserTag, ID: 9, FirstName: "Аня", Status: NewUserStatusRecently(false)}})},
		{"один участник", NewChannelsChannelParticipant(
			NewChannelParticipant(Member{UserID: 9, Role: RoleMember, JoinedAt: joined}, stranger),
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
		got := NewChannelParticipant(Member{UserID: 1, Role: role}, ParticipantViewer{ID: 2}).Tag()
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
	p := NewChannelParticipant(Member{UserID: 9, Role: RoleMember, JoinedAt: time.Unix(1787334148, 0)}, ParticipantViewer{ID: 2})
	decoded, ok := roundTripJSON(t, p).(map[string]any)
	if !ok {
		t.Fatal("участник не разобрался в объект")
	}
	if _, has := decoded["status"]; has {
		t.Error("присутствие уехало на строке участника")
	}
}

// can_edit — порт tweb canEditAdmin: создатель правит любого админа, прочие —
// только назначенных ими. Себя не правит никто (у себя — бит self). Это и есть
// пункт 5 ревью #401: прежде promoted_by не ехал, и клиент считал правимым
// чужого админа, а сервер отвечал 403.
func TestParticipants_AdminCanEditFollowsPromotedBy(t *testing.T) {
	admin := Member{UserID: 8, Role: RoleAdmin, PromotedBy: 5}
	cases := []struct {
		name string
		v    ParticipantViewer
		edit bool
		self bool
	}{
		{"создатель", ParticipantViewer{ID: 1, IsCreator: true}, true, false},
		{"назначивший", ParticipantViewer{ID: 5}, true, false},
		{"другой админ", ParticipantViewer{ID: 6}, false, false},
		{"сам админ", ParticipantViewer{ID: 8}, false, true},
	}
	for _, tc := range cases {
		a, ok := NewChannelParticipant(admin, tc.v).(ChannelParticipantAdmin)
		if !ok {
			t.Fatalf("%s: не channelParticipantAdmin", tc.name)
		}
		if a.PFlags["can_edit"] != tc.edit || a.PFlags["self"] != tc.self {
			t.Errorf("%s: pFlags=%v, ждали can_edit=%v self=%v", tc.name, a.PFlags, tc.edit, tc.self)
		}
		if a.PromotedBy != 5 {
			t.Errorf("%s: promoted_by=%d", tc.name, a.PromotedBy)
		}
	}
}

// Строка про себя у обычного участника — channelParticipantSelf; пригласивший
// по умолчанию он сам (вошёл по @имени).
func TestParticipants_SelfRow(t *testing.T) {
	p := NewChannelParticipant(Member{UserID: 9, Role: RoleMember, ViaRequest: true}, ParticipantViewer{ID: 9})
	s, ok := p.(ChannelParticipantSelf)
	if !ok {
		t.Fatalf("got %T, want ChannelParticipantSelf", p)
	}
	if s.InviterID != 9 || !s.PFlags["via_request"] {
		t.Fatalf("self = %+v", s)
	}
}

// Ограниченный участник в любом списке — channelParticipantBanned без left;
// выгнанный — с left. Ограничение админа не бывает: админ остаётся админом.
func TestParticipant_ToChannelParticipant(t *testing.T) {
	r := &MemberRestriction{UserID: 9, DeniedRights: PermSendMedia, RestrictedBy: 1, CreatedAt: time.Unix(1787334148, 0)}
	restricted := Participant{Member: Member{UserID: 9, Role: RoleMember}, Restriction: r}
	b, ok := restricted.ToChannelParticipant(ParticipantViewer{ID: 1}).(ChannelParticipantBanned)
	if !ok || b.PFlags["left"] || !b.BannedRights.Denies("send_media") || b.Date != 1787334148 {
		t.Fatalf("ограниченный: %#v", restricted.ToChannelParticipant(ParticipantViewer{ID: 1}))
	}
	kicked := Participant{Member: Member{UserID: 9}, Kicked: true, KickedBy: 1}
	if k, ok := kicked.ToChannelParticipant(ParticipantViewer{ID: 1}).(ChannelParticipantBanned); !ok || !k.PFlags["left"] {
		t.Fatalf("выгнанный: %#v", k)
	}
}

// banned_rights зрителя — ДЕЙСТВУЮЩИЙ набор: личные запреты ∪ дефолт чата
// (tweb hasRights берёт banned_rights вместо default_banned_rights).
func TestEffectiveBannedRights(t *testing.T) {
	now := time.Now()
	if EffectiveBannedRights(nil, AllMemberPerms, now) != nil {
		t.Fatal("без ограничения banned_rights не едет")
	}
	past := now.Add(-time.Hour)
	if EffectiveBannedRights(&MemberRestriction{DeniedRights: PermSendMedia, UntilDate: &past}, AllMemberPerms, now) != nil {
		t.Fatal("истёкшее ограничение не едет")
	}
	br := EffectiveBannedRights(&MemberRestriction{DeniedRights: PermSendMedia}, AllMemberPerms&^PermPinMessages, now)
	if br == nil || !br.Denies("send_media") || !br.Denies("pin_messages") || br.Denies("send_messages") {
		t.Fatalf("banned_rights = %#v", br)
	}
}
