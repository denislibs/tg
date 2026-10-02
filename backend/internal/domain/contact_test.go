package domain

import "testing"

// SeenBy — пользователь глазами смотрящего: если пир в его книге, карточка
// несёт имя ИЗ КОНТАКТА и pFlags.contact (как у оригинала, где сервер отдаёт
// user с именем из книги зрителя во всех ответах).
func TestUserSeenBy(t *testing.T) {
	profile := func() UserReal {
		u := NewUser(2, UserFlags{Premium: true})
		u.FirstName, u.LastName = "Боб", "Петров"
		return u
	}

	t.Run("контакт — имя из книги и флаги", func(t *testing.T) {
		got := profile().SeenBy(ContactView{Contact: true, Mutual: true, FirstName: "Бобби"})
		if got.FirstName != "Бобби" || got.LastName != "" {
			t.Fatalf("имя = %q %q, want имя из книги «Бобби» без фамилии", got.FirstName, got.LastName)
		}
		if !got.ContactRecord() || !got.MutualContact() || !got.Premium() {
			t.Fatalf("pFlags = %v, want contact+mutual_contact+premium", got.PFlags)
		}
	})

	t.Run("не контакт — профиль как есть, флагов нет", func(t *testing.T) {
		u := profile()
		u.PFlags["contact"] = true // устаревший флаг чужого снимка не переживает линзу
		got := u.SeenBy(ContactView{})
		if got.FirstName != "Боб" || got.LastName != "Петров" {
			t.Fatalf("имя = %q %q, want профильное", got.FirstName, got.LastName)
		}
		if got.ContactRecord() || got.MutualContact() {
			t.Fatalf("pFlags = %v, want без contact/mutual_contact", got.PFlags)
		}
	})

	t.Run("взаимность без записи в книге зрителя — имя профильное", func(t *testing.T) {
		got := profile().SeenBy(ContactView{Mutual: true, FirstName: "мусор"})
		if got.FirstName != "Боб" || got.ContactRecord() || !got.MutualContact() {
			t.Fatalf("got %q %v", got.FirstName, got.PFlags)
		}
	})

	t.Run("удалённый аккаунт имени из книги не получает", func(t *testing.T) {
		u := NewUser(2, UserFlags{Deleted: true})
		u.FirstName, u.LastName = "Deleted", "Account"
		got := u.SeenBy(ContactView{Contact: true, FirstName: "Бобби"})
		if got.FirstName != "Deleted" || got.LastName != "Account" {
			t.Fatalf("имя = %q %q, want Deleted Account", got.FirstName, got.LastName)
		}
	})

	t.Run("pFlags исходной карточки не мутируются", func(t *testing.T) {
		u := profile()
		_ = u.SeenBy(ContactView{Contact: true, FirstName: "Бобби"})
		if u.ContactRecord() || u.FirstName != "Боб" {
			t.Fatalf("линза испортила исходник: %q %v", u.FirstName, u.PFlags)
		}
	})
}
