package tl

import "fmt"

//go:generate go run ../../../cmd/tl-schemagen -schema ../../../../schema -out schema_gen.go

// Param — параметр конструктора в том виде, в каком его требует провод.
//
// Тип уже очищен от префикса необязательности: `flags.7?Vector<PhotoSize>` в
// схеме становится Type="Vector<PhotoSize>", Flags="flags", Bit=7. Так кодеку
// не приходится разбирать строку типа на каждом поле.
type Param struct {
	Name  string
	Type  string
	Flags string // имя поля-маски; пусто — параметр обязательный
	Bit   uint
}

// Optional — необязательный ли параметр (лежит за битом маски).
func (p Param) Optional() bool { return p.Flags != "" }

// Constructor — запись схемы: числовой id, порядок и типы параметров.
type Constructor struct {
	ID        int32
	Predicate string
	Type      string
	Params    []Param
}

var (
	byPredicate map[string]*Constructor
	byID        map[int32]*Constructor
	clientOwn   map[string]map[string]bool
)

func init() {
	byPredicate = make(map[string]*Constructor, len(schemaConstructors))
	byID = make(map[int32]*Constructor, len(schemaConstructors))
	for i := range schemaConstructors {
		c := &schemaConstructors[i]
		if prev, dup := byPredicate[c.Predicate]; dup {
			panic(fmt.Sprintf("tl: конструктор %s объявлен дважды (id %d и %d)", c.Predicate, prev.ID, c.ID))
		}
		if prev, dup := byID[c.ID]; dup {
			// Столкновение id — единственная ошибка схемы, которую нельзя
			// заметить по данным: разбор просто уедет в чужой конструктор.
			// Своим конструкторам id назначается вручную, поэтому проверка
			// стоит здесь, а не в тесте одной из сторон.
			panic(fmt.Sprintf("tl: id %#08x занят и конструктором %s, и %s", uint32(c.ID), prev.Predicate, c.Predicate))
		}
		byPredicate[c.Predicate] = c
		byID[c.ID] = c
	}

	clientOwn = make(map[string]map[string]bool, len(clientParams))
	for predicate, names := range clientParams {
		set := make(map[string]bool, len(names))
		for _, n := range names {
			set[n] = true
		}
		clientOwn[predicate] = set
	}
}

// ConstructorByPredicate — запись схемы по дискриминатору `_`.
func ConstructorByPredicate(predicate string) (*Constructor, bool) {
	c, ok := byPredicate[predicate]
	return c, ok
}

// ConstructorByID — запись схемы по числовому id с провода.
func ConstructorByID(id int32) (*Constructor, bool) {
	c, ok := byID[id]
	return c, ok
}

// IsClientOnlyPredicate — конструктор объявлен только для клиента, id у него
// нет, на провод он не идёт.
func IsClientOnlyPredicate(predicate string) bool { return clientOnlyPredicates[predicate] }

// isClientParam — поле объявлено клиентским для этого конструктора.
func isClientParam(predicate, name string) bool { return clientOwn[predicate][name] }

// SchemaLayer — слой схемы, из которой напечатана таблица.
func SchemaLayer() int { return schemaLayer }
