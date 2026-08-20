package domain

import (
	"time"
	"unicode/utf8"
)

// MaxFolderNameLength — лимит имени папки (tweb MAX_FOLDER_NAME_LENGTH).
const MaxFolderNameLength = 12

// MaxFoldersPerUser — лимит числа папок (Telegram default limit).
const MaxFoldersPerUser = 10

// DialogFilter — пользовательская папка чатов: включённые типы чатов + точечные
// include/exclude списки chat_id. Диалог попадает в папку по алгоритму
// testDialogForFilter (клиент): exclude-список → нет; include-список → да;
// иначе по флагам типов с учётом exclude_muted/exclude_read.
//
// Имя — из схемы: это конструктор `dialogFilter`, а `folder` в схеме принадлежит
// ДРУГОЙ сущности (раскладка «все чаты»/«архив», domain.Folder в mtdialog.go).
// Прежнее имя Folder называло здесь чужой объект и обязано было столкнуться с
// ним при порте — столкновение снято переименованием, а не суффиксом.
type DialogFilter struct {
	ID           int64
	Title        string
	Pos          int
	Contacts     bool
	NonContacts  bool
	Groups       bool
	Broadcasts   bool
	Bots         bool
	ExcludeMuted bool
	ExcludeRead  bool
	IncludeChats []int64
	ExcludeChats []int64
}

// HasIncludes — есть ли хоть одно правило включения (tweb: папка без
// включённых чатов/типов не сохраняется).
func (f DialogFilter) HasIncludes() bool {
	return f.Contacts || f.NonContacts || f.Groups || f.Broadcasts || f.Bots || len(f.IncludeChats) > 0
}

// ValidFolderTitle — непустое имя не длиннее MaxFolderNameLength рун.
func ValidFolderTitle(title string) bool {
	return title != "" && utf8.RuneCountInString(title) <= MaxFolderNameLength
}

// FolderInvite — ссылка-приглашение в папку (Telegram chatlist invite): владелец
// папки шарит набор своих групп/каналов; по slug другой юзер вступает в них и
// получает копию папки. ChatIDs — расшаренные чаты (только группы/каналы).
type FolderInvite struct {
	ID        int64
	Slug      string
	FolderID  int64
	OwnerID   int64
	Title     string
	ChatIDs   []int64
	CreatedAt time.Time
}

// FolderInviteChat — превью расшаренного чата для экрана вступления по ссылке.
type FolderInviteChat struct {
	ID          int64
	Title       string
	Type        string // 'group'|'channel'
	MemberCount int
}
