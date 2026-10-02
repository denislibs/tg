package domain

import "time"

// ContactRecord is one entry in a user's address book: the owner (OwnerID) saved another
// user (UserID) under a name of their own choosing, optionally with a note and a
// "let them see my phone number" flag. The saved name is the owner's — it does not
// change the contact's own profile name.
type ContactRecord struct {
	OwnerID   int64
	UserID    int64
	FirstName string
	LastName  string
	// Note — заметка владельца о контакте (userFull.note): текст с разметкой.
	// nil — заметки нет; на ЗАПИСИ (contacts.addContact без note) nil значит
	// «не трогать», а не «стереть».
	Note       *TextWithEntities
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

// ContactNoteMaxLen — предел заметки контакта в UTF-16 единицах: поле
// заметки оригинала ограничено 128 (tweb editContact.tsx, InputFieldEmoji
// maxLength), и сервер держит тот же предел, а не доверяет клиенту.
const ContactNoteMaxLen = 128

// ContactView — то, что книга ЗРИТЕЛЯ говорит о пользователе в краткой
// карточке: в книге ли он (user.pFlags.contact), есть ли зритель в его книге
// (user.pFlags.mutual_contact) и под каким именем зритель его сохранил.
type ContactView struct {
	// Contact — пир в книге зрителя (user.pFlags.contact).
	Contact bool
	// Mutual — и зритель в книге пира (user.pFlags.mutual_contact).
	Mutual bool
	// FirstName/LastName — имя из книги зрителя; значимо только при Contact.
	FirstName string
	LastName  string
}

// SeenBy — пользователь ГЛАЗАМИ СМОТРЯЩЕГО: единственное место, где краткая
// карточка `user` получает то, что зависит от книги зрителя.
//
// У оригинала сервер отдаёт `user` с first_name/last_name ИЗ КОНТАКТА
// смотрящего и с pFlags.contact во всех ответах, где этот user есть (диалоги,
// история, участники, поиск, профиль, апдейты), а клиент кладёт карточку в
// кэш как есть (tweb appUsersManager.saveApiUser) и имени из книги не
// подставляет. Поэтому линзу обязан пройти КАЖДЫЙ путь сборки карточки для
// зрителя: карточка, собранная мимо неё, затирает в кэше клиента имя из книги
// профильным — «то Боб, то Боб Петров».
//
// Флаги ставятся и СНИМАЮТСЯ: карточка может прийти уже с чужими флагами.
// Удалённый аккаунт имени из книги не получает — он остаётся «Deleted
// Account», как и у оригинала, где удалённый пир приходит без имени.
func (u UserReal) SeenBy(v ContactView) UserReal {
	flags := make(map[string]bool, len(u.PFlags)+2)
	for k, on := range u.PFlags {
		flags[k] = on
	}
	setPFlag(&flags, "contact", v.Contact)
	setPFlag(&flags, "mutual_contact", v.Mutual)
	u.PFlags = flags
	if v.Contact && !u.Deleted() {
		u.FirstName, u.LastName = v.FirstName, v.LastName
	}
	return u
}

// ContactCard — то, что ЗРИТЕЛЬ знает о пире по адресным книгам: этим
// дополняется профиль (users.userFull). Всё здесь зависит от зрителя, как
// pFlags.contact у оригинала, поэтому считается на каждый запрос профиля.
type ContactCard struct {
	// ContactView — часть, которая ложится на краткую карточку (SeenBy).
	ContactView
	// Note — заметка зрителя о пире (userFull.note); nil — нет.
	Note *TextWithEntities
	// PersonalPhotoID — media id личного фото, которое зритель поставил пиру
	// (userFull.personal_photo); 0 — нет.
	PersonalPhotoID int64
}
