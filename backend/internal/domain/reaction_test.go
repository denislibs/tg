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

// ПРАВО на список — то же правило целиком, вместе с личкой. Пин держит ровно
// разницу с флагом: копия, забывшая личку, отказала бы в списке реагировавших в
// личных чатах, а копия, забывшая канал, вернула бы утечку, ради которой всё и
// затевалось (задача #93). Терм оригинала — tweb
// src/components/chat/reactionContextMenu.ts:95 `!!message.reactions?.pFlags
// .can_see_list || message.peerId.isUser()`.
func TestCanViewReactionsList_GroupsAndPrivate(t *testing.T) {
	cases := map[string]bool{
		ChatTypeGroup:   true,
		ChatTypePrivate: true,
		// Вещательный канал — единственный, где списка нет.
		ChatTypeChannel: false,
		ChatTypeSaved:   false,
		ChatTypeSecret:  false,
		// Вид чата неизвестен — доступ не утверждается.
		"": false,
	}
	for typ, want := range cases {
		if got := CanViewReactionsList(typ); got != want {
			t.Errorf("CanViewReactionsList(%q) = %v; want %v", typ, got, want)
		}
	}
	// Право не может быть уже флага: флаг — его половина, а не соседнее
	// правило. Пин ловит попытку развести их по копиям.
	for _, typ := range []string{ChatTypeGroup, ChatTypeChannel, ChatTypePrivate, ChatTypeSaved, ChatTypeSecret, ""} {
		if CanSeeReactionsList(typ) && !CanViewReactionsList(typ) {
			t.Errorf("%q: флаг утверждён, а права нет", typ)
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
