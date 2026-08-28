package ffmpeg

import "testing"

// parseProbe разбирает вывод `ffprobe -of json -show_format -show_streams`:
// размеры первого видеопотока, длительность контейнера и теги трека.
func TestParseProbe(t *testing.T) {
	tests := []struct {
		name string
		out  string
		want probeMeta
	}{
		{
			name: "mp3 с ID3-тегами (обложка отдельным video-потоком)",
			out: `{"streams":[
				{"codec_type":"audio","codec_name":"mp3"},
				{"codec_type":"video","codec_name":"mjpeg","width":300,"height":300}
			],"format":{"duration":"139.128000","tags":{"title":"Track One","artist":"denis1488","album":"X"}}}`,
			want: probeMeta{Width: 300, Height: 300, Duration: 139, Title: "Track One", Performer: "denis1488", HasVideo: true, HasAudio: true},
		},
		{
			name: "mp3 без тегов — только длительность",
			out:  `{"streams":[{"codec_type":"audio","codec_name":"mp3"}],"format":{"duration":"12.4"}}`,
			want: probeMeta{Duration: 12, HasAudio: true},
		},
		{
			name: "ключи тегов в любом регистре, значения обрезаются",
			out:  `{"streams":[],"format":{"duration":"1","tags":{"TITLE":"  Song  ","Artist":"Denis"}}}`,
			want: probeMeta{Duration: 1, Title: "Song", Performer: "Denis"},
		},
		{
			name: "пустые/пробельные теги — как будто их нет",
			out:  `{"streams":[],"format":{"duration":"1","tags":{"title":"","artist":"   "}}}`,
			want: probeMeta{Duration: 1},
		},
		{
			name: "ogg/opus: теги лежат на аудиопотоке, а не на контейнере",
			out: `{"streams":[{"codec_type":"audio","codec_name":"opus","tags":{"TITLE":"Ogg Song","ARTIST":"Ogg Guy"}}],
				"format":{"duration":"5.0"}}`,
			want: probeMeta{Duration: 5, Title: "Ogg Song", Performer: "Ogg Guy", HasAudio: true},
		},
		{
			name: "нестроковое значение тега не ломает разбор размеров",
			out: `{"streams":[{"codec_type":"video","width":1920,"height":1080}],
				"format":{"duration":"3.6","tags":{"title":42}}}`,
			want: probeMeta{Width: 1920, Height: 1080, Duration: 4, HasVideo: true},
		},
		{
			name: "видео без тегов — поведение прежнее",
			out:  `{"streams":[{"codec_type":"audio"},{"codec_type":"video","width":640,"height":480}],"format":{"duration":"7.2"}}`,
			want: probeMeta{Width: 640, Height: 480, Duration: 7, HasVideo: true, HasAudio: true},
		},
		{
			name: "битый json — всё по нулям",
			out:  `not json`,
			want: probeMeta{},
		},
		{
			name: "видео без аудиодорожки (гифка) — HasAudio остаётся false",
			out:  `{"streams":[{"codec_type":"video","width":320,"height":240}],"format":{"duration":"2.0"}}`,
			want: probeMeta{Width: 320, Height: 240, Duration: 2, HasVideo: true},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseProbe([]byte(tt.out))
			if got != tt.want {
				t.Fatalf("parseProbe = %+v, want %+v", got, tt.want)
			}
		})
	}
}

// isAnimated — признак гифки (telegram documentAttributeAnimated, из которого
// tweb выводит doc.type === 'gif'): настоящий image/gif либо видео без
// аудиодорожки. Гифка рисуется в ленте иначе видео (бейдж «GIF» вместо
// таймкода, зацикленный автоплей без кнопки play — tweb video.ts:120-123,164-171).
func TestIsAnimated(t *testing.T) {
	tests := []struct {
		name string
		mime string
		meta probeMeta
		want bool
	}{
		{
			name: "настоящий image/gif — гифка даже без успешного probe",
			mime: "image/gif",
			meta: probeMeta{},
			want: true,
		},
		{
			name: "видео без аудиодорожки — гифка (telegram nosound_video)",
			mime: "video/mp4",
			meta: probeMeta{HasVideo: true},
			want: true,
		},
		{
			name: "видео со звуком — обычное видео",
			mime: "video/mp4",
			meta: probeMeta{HasVideo: true, HasAudio: true},
			want: false,
		},
		{
			name: "ffprobe не отработал (нулевой probeMeta) — НЕ гифка",
			mime: "video/mp4",
			meta: probeMeta{},
			want: false,
		},
		{
			name: "картинка не-gif — не гифка",
			mime: "image/jpeg",
			meta: probeMeta{HasVideo: true},
			want: false,
		},
		{
			name: "аудио без видеодорожки — не гифка",
			mime: "audio/mpeg",
			meta: probeMeta{HasAudio: true},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isAnimated(tt.mime, tt.meta); got != tt.want {
				t.Fatalf("isAnimated(%q, %+v) = %v, want %v", tt.mime, tt.meta, got, tt.want)
			}
		})
	}
}
