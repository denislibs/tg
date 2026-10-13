package chat

import (
	"sync"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Идущие сборки превью — по одной на сообщение или отложенное.
//
// Правка, которая ссылку не меняет, пока карточка ещё собирается, сдвигает
// условие записи (edited_at у сообщения, текст/решение у отложенного), и
// идущая сборка свою карточку уже не запишет. Вторую сборку той же ссылки не
// начинаем: правка перенацеливает идущую (join), а та, если её запись не
// прошла, повторяет её под новую цель (settle → false) — без второго похода
// на сайт и второй картинки в хранилище.

// previewTarget — под что записывать карточку.
type previewTarget struct {
	gen int // растёт с каждым перенацеливанием
	in  domain.WebPageInput
	// сообщение: условие записи и получатели кадра
	editedAt   *time.Time
	recipients []int64
	// отложенное: условие записи
	text     string
	entities domain.MessageEntities
	choice   *domain.WebPageInput
}

type previewFlight struct {
	key, url string
	t        previewTarget
}

// buildSlots — сколько фоновых сборок карточек ходит в сеть одновременно:
// всплеск ссылок не плодит сотни горутин, держащих соединения с сайтами.
const buildSlots = 32

// previewFlights — нулевое значение готово к работе.
type previewFlights struct {
	mu    sync.Mutex
	m     map[string]*previewFlight
	slots chan struct{}
}

// acquireBuild занимает слот сетевой части сборки; ждёт не дольше
// previewTimeout (иначе сборка не начинается — карточки не будет).
func (f *previewFlights) acquireBuild() bool {
	f.mu.Lock()
	if f.slots == nil {
		f.slots = make(chan struct{}, buildSlots)
	}
	slots := f.slots
	f.mu.Unlock()
	select {
	case slots <- struct{}{}:
		return true
	case <-time.After(previewTimeout):
		return false
	}
}

func (f *previewFlights) releaseBuild() { <-f.slots }

// join — сборка ссылки url для key: идёт сборка той же ссылки — она
// перенацеливается (set) и started=false; иначе заводится новая (прежняя,
// другой ссылки, дорабатывает впустую — её условие записи уже ложно).
func (f *previewFlights) join(key, url string, set func(*previewTarget)) (*previewFlight, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.m == nil {
		f.m = map[string]*previewFlight{}
	}
	if cur := f.m[key]; cur != nil && sameURL(cur.url, url) {
		set(&cur.t)
		cur.t.gen++
		return cur, false
	}
	fl := &previewFlight{key: key, url: url}
	set(&fl.t)
	f.m[key] = fl
	return fl, true
}

// target — текущая цель сборки (копия).
func (f *previewFlights) target(fl *previewFlight) previewTarget {
	f.mu.Lock()
	defer f.mu.Unlock()
	return fl.t
}

// settle — запись под цель поколения gen не прошла: если цель с тех пор не
// менялась, сборка закончена (true, снята); иначе её надо повторить (false).
func (f *previewFlights) settle(fl *previewFlight, gen int) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if fl.t.gen != gen {
		return false
	}
	if f.m[fl.key] == fl {
		delete(f.m, fl.key)
	}
	return true
}

// drop снимает сборку (её место могла занять сборка другой ссылки — ту не трогаем).
func (f *previewFlights) drop(fl *previewFlight) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.m[fl.key] == fl {
		delete(f.m, fl.key)
	}
}
