package domain

import "unicode/utf8"

// MaxFolderNameLength — лимит имени папки (tweb MAX_FOLDER_NAME_LENGTH).
const MaxFolderNameLength = 12

// MaxFoldersPerUser — лимит числа папок (Telegram default limit).
const MaxFoldersPerUser = 10

// Folder — папка чатов (tweb DialogFilter): включённые типы чатов + точечные
// include/exclude списки chat_id. Диалог попадает в папку по алгоритму
// testDialogForFilter (клиент): exclude-список → нет; include-список → да;
// иначе по флагам типов с учётом exclude_muted/exclude_read.
type Folder struct {
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
func (f Folder) HasIncludes() bool {
	return f.Contacts || f.NonContacts || f.Groups || f.Broadcasts || f.Bots || len(f.IncludeChats) > 0
}

// ValidFolderTitle — непустое имя не длиннее MaxFolderNameLength рун.
func ValidFolderTitle(title string) bool {
	return title != "" && utf8.RuneCountInString(title) <= MaxFolderNameLength
}
