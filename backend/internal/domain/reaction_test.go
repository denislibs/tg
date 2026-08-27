package domain

import "testing"

// Правило «виден ли СПИСОК реагировавших» — вид чата, и других значений у него
// нет. Пин держит именно ветвление: пока флаг был «всегда true», клиент честно
// показывал бы аватарки и в вещательном канале, где реакции анонимны, а пока
// его не было вовсе — не показывал бы их нигде, кроме лички (задача #89).
func TestCanSeeReactionsList_GroupsOnly(t *testing.T) {
	cases := map[string]bool{
		ChatTypeGroup: true,
		// Вещательный канал: реакции анонимны, списка нет
		// (core.telegram.org/api/reactions — «In groups, …»).
		ChatTypeChannel: false,
		// Личка, самочат и секретный чат: ключ пира — пользователь, и на вопрос
		// отвечает КЛИЕНТ вторым термом того же условия
		// (tweb src/components/chat/reactions.ts:306).
		ChatTypePrivate: false,
		ChatTypeSaved:   false,
		ChatTypeSecret:  false,
		// Вид чата неизвестен — утверждать право нельзя.
		"": false,
	}
	for typ, want := range cases {
		if got := CanSeeReactionsList(typ); got != want {
			t.Errorf("CanSeeReactionsList(%q) = %v; want %v", typ, got, want)
		}
	}
}

// Флаг — ЗНАЧЕНИЕ правила, а не «поставили однажды»: снятое право снимает и
// параметр, а пустой pFlags не едет на провод вовсе.
func TestMessageReactions_SetCanSeeList(t *testing.T) {
	r := NewMessageReactions([]MTReactionCount{NewReactionCount(NewReactionEmoji("🔥"), 1, false)}, nil)
	if r.PFlags["can_see_list"] {
		t.Fatal("свежий агрегат не должен утверждать право на список")
	}
	r.SetCanSeeList(true)
	if !r.PFlags["can_see_list"] {
		t.Fatal("SetCanSeeList(true) не выставил флаг")
	}
	r.SetCanSeeList(false)
	if r.PFlags != nil {
		t.Fatalf("SetCanSeeList(false) оставил pFlags = %#v", r.PFlags)
	}
}
