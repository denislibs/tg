// Package langpack — usecase языкового пакета: выдача строк языка, разница по
// версии клиента и заливка строк из источника (словарей веб-клиента).
package langpack

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// Repo — хранилище языкового пакета.
//
// Порт держит ХРАНЕНИЕ и ничего кроме: что считать изменением, когда растить
// версию и кому уезжает снятый ключ — решает интерактор. Иначе правило «версия
// растёт при любом изменении» жило бы в SQL, где его не прочитать.
type Repo interface {
	// Languages — все языки пакета со счётчиками строк.
	Languages(ctx context.Context) ([]domain.LangPackLanguage, error)
	// Language — один язык; domain.ErrNotFound, если такого нет.
	Language(ctx context.Context, code string) (domain.LangPackLanguage, error)
	// Version — текущая версия языка; domain.ErrNotFound, если языка нет.
	Version(ctx context.Context, code string) (int, error)
	// Strings — строки языка НОВЕЕ версии sinceVersion (sinceVersion = 0 —
	// все). withDeleted включает в выдачу снятые ключи.
	Strings(ctx context.Context, code string, sinceVersion int, withDeleted bool) ([]domain.LangPackStringRecord, error)
	// StringsByKeys — только запрошенные ключи. Ключа нет в языке — нет и
	// записи: чем это ответить клиенту, решает интерактор.
	StringsByKeys(ctx context.Context, code string, keys []string) ([]domain.LangPackStringRecord, error)
	// Apply — ОДНОЙ транзакцией: паспорт языка, его новая версия и строки,
	// которые этой версией изменились (снятые — записью с Deleted).
	//
	// Одной транзакцией не для скорости: между «записали строки» и «записали
	// версию» клиент, спросивший разницу, получил бы новые строки под старой
	// версией и больше никогда бы за ними не пришёл.
	Apply(ctx context.Context, meta domain.LangPackLanguageMeta, version int, changed []domain.LangPackStringRecord) error
}
