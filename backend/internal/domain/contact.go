package domain

import "time"

// ContactRecord is one entry in a user's address book: the owner (OwnerID) saved another
// user (UserID) under a name of their own choosing, optionally with a note and a
// "let them see my phone number" flag. The saved name is the owner's — it does not
// change the contact's own profile name.
type ContactRecord struct {
	OwnerID    int64
	UserID     int64
	FirstName  string
	LastName   string
	Note       string
	SharePhone bool
	CreatedAt  time.Time
	// User — сам пир в форме конструктора `user`, наполняется read-моделью (в
	// строке contacts его нет). Прежде здесь лежала россыпь плоских полей —
	// username, avatar_url, avatar_preview, phone, display_name, — то есть
	// ВТОРАЯ форма того же пользователя рядом с первой.
	//
	// Имя в карточке — то, под которым контакт сохранил ВЛАДЕЛЕЦ (FirstName/
	// LastName выше): ровно так работает импорт контактов в оригинале, где
	// видимая владельцу карточка пира несёт его вариант имени.
	User UserReal
	// HasCustomPhoto — у владельца задано личное фото этого контакта (User.Photo
	// уже подменён им и несёт pFlags.personal). Позволяет UI показать
	// «Изменить»/«Сбросить» фото.
	HasCustomPhoto bool
	// IsBot — контакт является ботом (users.is_bot). Ботов нельзя держать в
	// адресной книге (Telegram), поэтому read-model их отфильтровывает.
	IsBot bool
}
