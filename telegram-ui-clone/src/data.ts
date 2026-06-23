export type ChatType = 'private' | 'group' | 'channel' | 'bot' | 'saved'
export type MsgStatus = 'sent' | 'read'

export interface MediaItem {
  gradient: string
  emoji?: string
}

export interface ConvMsg {
  type:
    | 'date'
    | 'service'
    | 'text'
    | 'sticker'
    | 'voice'
    | 'photo'
    | 'video'
    | 'album'
    | 'document'
    | 'audio'
    | 'roundVideo'
  out?: boolean
  sender?: string
  senderColor?: string
  text?: string // also used as media caption
  emoji?: string
  time?: string
  status?: MsgStatus
  reply?: { name: string; text: string; color?: string }
  duration?: string // voice message length, e.g. "0:14"
  waveform?: number[] // voice waveform bar heights (0..1)
  // media
  media?: MediaItem // single photo/video placeholder
  album?: MediaItem[] // album grid (2–10)
  videoDuration?: string // overlay on video / round video
  // document
  document?: { name: string; size: string; ext: string; color: string }
  // audio / music
  audio?: { title: string; artist: string; duration: string }
  // link preview attached to a text message
  webPage?: { siteName: string; title: string; description?: string; gradient?: string; emoji?: string }
}

export interface Chat {
  id: string
  name: string
  avatar: string
  avatarText?: string
  avatarEmoji?: string
  date: string
  preview: string
  verified?: boolean
  muted?: boolean
  selected?: boolean
  unread?: number
  sent?: boolean
  type: ChatType
  owned?: boolean
  status?: string // header subtitle: "last seen recently" / "12 345 members" / "4 566 subscribers"
  online?: boolean // private chats: show the green online dot
  username?: string
  description?: string
  links?: { label: string; value: string }[]
  messages?: ConvMsg[]
}

// Per-sender colors for group chats (Telegram-style)
const C = {
  red: '#e17076',
  green: '#7bc862',
  blue: '#65aadd',
  purple: '#a695e7',
  pink: '#ee7aae',
  cyan: '#6ec9cb',
  orange: '#faa774',
}

// A long, lively group history (~200 messages) with long single-sender runs so
// the sticky group avatar is clearly visible while scrolling.
function buildKutezhMessages(): ConvMsg[] {
  const people = [
    { sender: 'Аня', senderColor: C.pink },
    { sender: 'Макс', senderColor: C.blue },
    { sender: 'Лёха', senderColor: C.green },
    { sender: 'Костя', senderColor: C.orange },
    { sender: 'Ира', senderColor: C.purple },
    { sender: 'Дима', senderColor: C.cyan },
  ]
  const lines = [
    'ну что, сегодня собираемся?', 'я только за', 'во сколько?', 'давайте пораньше',
    'я могу принести колонку', 'отлично 🙌', 'кто за пиццу?', 'я закажу',
    'мне без ананасов 😅', 'двойной сыр всем', 'еду уже', 'буду минут через 20',
    'возьмите кто-нибудь лёд', 'есть', 'захвачу вино', 'и сок не забудьте',
    'погнали 🚀', 'я опаздываю немного', 'ждём', 'не торопись',
    'кто где паркуется?', 'во дворе есть места', 'ок понял', 'уже почти на месте',
    'открывайте 😄', 'поднимаюсь', 'плейлист готов', 'врубай 🔊',
    'это лучший вечер', 'согласен', 'ещё по одной?', 'давай',
    'кто остаётся?', 'я до утра 🌙', 'такси вызвали?', 'да, 5 минут',
    'спасибо за вечер ❤️', 'было супер', 'повторим на выходных', 'обязательно',
  ]
  const out: ConvMsg[] = [
    { type: 'service', text: 'Вы создали группу «Кутёж»' },
    { type: 'service', text: 'Аня, Макс и ещё 5 присоединились к группе' },
    { type: 'date', text: 'Yesterday' },
    { type: 'service', text: 'Вы начали видеочат' },
  ]
  let li = 0
  let mins = 17 * 60 + 20 // start ~17:20
  const stamp = () => {
    mins += 1 + (li % 3)
    const h = Math.floor(mins / 60) % 24
    const m = mins % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  let pIdx = 0
  while (out.length < 195) {
    const run = 4 + (out.length % 11) // runs of 4..14 messages
    const mine = pIdx % 4 === 3 // every 4th run is from "me"
    const p = people[pIdx % people.length]
    pIdx++
    for (let k = 0; k < run && out.length < 195; k++) {
      const text = lines[li++ % lines.length]
      if (mine) out.push({ type: 'text', out: true, text, time: stamp(), status: 'read' })
      else out.push({ type: 'text', sender: p.sender, senderColor: p.senderColor, text, time: stamp() })
    }
  }
  // the original tail — keeps the chat preview/last message consistent
  out.push({ type: 'date', text: 'Today' })
  out.push({ type: 'text', sender: 'Аня', senderColor: C.pink, text: 'Ну что, сегодня собираемся?', time: '23:40' })
  out.push({ type: 'text', sender: 'Макс', senderColor: C.blue, text: 'я за 🙌', time: '23:41' })
  out.push({ type: 'text', out: true, text: 'давайте в 9 у меня', time: '23:42', status: 'read' })
  out.push({ type: 'text', sender: 'Аня', senderColor: C.pink, text: 'отлично, я принесу вино', time: '23:45' })
  out.push({ type: 'sticker', sender: 'Макс', senderColor: C.blue, emoji: '🍷', time: '23:46' })
  out.push({ type: 'text', sender: 'Лёха', senderColor: C.green, text: 'я уже выезжаю, ждите', time: '00:14' })
  return out
}

export const chats: Chat[] = [
  {
    id: 'dollhouse-work',
    name: 'kyzdar.ai',
    avatar: 'linear-gradient(135deg,#8a5bff,#5b8dff)',
    avatarEmoji: '✨',
    date: 'Wed',
    preview: '🚀 ОЧЕНЬ ВАЖНО!!! Наш основ…',
    selected: true,
    type: 'channel',
    status: '4 566 subscribers',
    description: 'Официальный канал kyzdar.ai — живые фото, видео и анонсы. Запись и вопросы — у менеджера.',
    links: [
      { label: 'Основной канал', value: 'https://t.me/joinchat/Ws41XjxT6Uw5Nmly' },
      { label: 'Ссылка для приглашения', value: 'https://t.me/+6y3783resPU4Y2Ni' },
      { label: 'Менеджер', value: '@kyzdar_manager' },
    ],
  },
  {
    id: 'kutezh',
    name: 'Кутёж',
    avatar: 'linear-gradient(135deg,#f7971e,#ffd200)',
    avatarEmoji: '🍻',
    date: '00:14',
    preview: 'Лёха: я уже выезжаю, ждите',
    type: 'group',
    status: '8 members, 3 online',
    unread: 12,
    messages: buildKutezhMessages(),
  },
  {
    id: 'artem',
    name: 'Артём',
    avatar: 'linear-gradient(135deg,#42e695,#3bb2b8)',
    avatarText: 'А',
    date: 'Jun 12',
    preview: 'скинь как доедешь',
    type: 'private',
    status: 'last seen 5 minutes ago',
    username: 'artem_k',
    messages: [
      { type: 'date', text: 'June 12' },
      { type: 'text', out: false, text: 'ты на тренировку идёшь сегодня?', time: '18:02' },
      { type: 'text', out: true, text: 'да, в 8 буду', time: '18:10', status: 'read' },
      {
        type: 'voice',
        out: false,
        time: '18:10',
        duration: '0:14',
        waveform: [0.3, 0.6, 0.4, 0.8, 1, 0.7, 0.5, 0.9, 0.6, 0.3, 0.5, 0.8, 0.6, 0.4, 0.7, 1, 0.6, 0.4, 0.5, 0.3, 0.7, 0.9, 0.5, 0.4, 0.6, 0.8, 0.5, 0.3],
      },
      { type: 'text', out: false, text: 'огонь, возьми мне воды по пути', time: '18:11' },
      { type: 'text', out: true, text: 'ок 👍', time: '18:12', status: 'read' },
      {
        type: 'photo',
        out: false,
        media: { gradient: 'linear-gradient(135deg,#f7971e,#ffd200)', emoji: '🏋️' },
        time: '18:31',
      },
      {
        type: 'text',
        out: true,
        text: 'красава! трек зацени {e:🔥}{e:🎧}',
        time: '18:32',
        status: 'read',
      },
      {
        type: 'audio',
        out: true,
        audio: { title: 'Midnight City', artist: 'M83', duration: '4:03' },
        time: '18:32',
        status: 'read',
      },
      {
        type: 'document',
        out: false,
        document: { name: 'Программа тренировок.pdf', size: '2.4 MB', ext: 'PDF', color: '#e8564f' },
        time: '18:33',
      },
      {
        type: 'album',
        out: false,
        album: [
          { gradient: 'linear-gradient(135deg,#43cea2,#185a9d)', emoji: '🥗' },
          { gradient: 'linear-gradient(135deg,#ff6a88,#ff99ac)', emoji: '🍓' },
          { gradient: 'linear-gradient(135deg,#654ea3,#eaafc8)', emoji: '🥑' },
          { gradient: 'linear-gradient(135deg,#f7971e,#ffd200)', emoji: '🍳' },
        ],
        text: 'мой рацион на неделю',
        time: '18:34',
      },
      {
        type: 'roundVideo',
        out: true,
        media: { gradient: 'linear-gradient(135deg,#42e695,#3bb2b8)', emoji: '🏃' },
        videoDuration: '0:08',
        time: '18:35',
        status: 'read',
      },
      {
        type: 'video',
        out: false,
        media: { gradient: 'linear-gradient(135deg,#2980b9,#6dd5fa)', emoji: '🎬' },
        videoDuration: '0:42',
        time: '18:36',
      },
      {
        type: 'text',
        out: false,
        text: 'смотри какую статью нашёл https://telegram.org',
        time: '18:40',
        webPage: {
          siteName: 'Telegram',
          title: 'Telegram – a new era of messaging',
          description: 'Fast. Secure. Powerful. The messaging app focused on speed and security.',
          gradient: 'linear-gradient(135deg,#8a5bff,#5b8dff)',
          emoji: '✈️',
        },
      },
      { type: 'text', out: false, text: 'скинь как доедешь', time: '18:30' },
    ],
  },
  {
    id: 'work-team',
    name: 'Проект «Феникс»',
    avatar: 'linear-gradient(135deg,#6a11cb,#2575fc)',
    avatarEmoji: '🔥',
    date: 'Jun 12',
    preview: 'Ирина: задеплоили, проверяйте',
    type: 'group',
    status: '24 members',
    muted: true,
    messages: [
      { type: 'date', text: 'June 12' },
      { type: 'text', sender: 'Дмитрий', senderColor: C.cyan, text: 'Коллеги, стендап через 10 минут', time: '10:50' },
      { type: 'text', out: true, text: 'буду', time: '10:51', status: 'read' },
      { type: 'text', sender: 'Ирина', senderColor: C.purple, text: 'я чуть опоздаю, доделываю ПР', time: '10:52' },
      { type: 'text', sender: 'Дмитрий', senderColor: C.cyan, text: 'ок, ждём', time: '10:53' },
      { type: 'text', sender: 'Ирина', senderColor: C.purple, text: 'задеплоили, проверяйте', time: '14:20' },
    ],
  },
  {
    id: 'telegram',
    name: 'Telegram',
    avatar: 'linear-gradient(135deg,#37aee2,#1e96c8)',
    avatarEmoji: 'tg-logo',
    date: 'Jun 12',
    preview: 'Код для входа в Ваш аккаунт Tel…',
    verified: true,
    type: 'private',
    status: 'service notifications',
    username: 'telegram',
    messages: [
      { type: 'date', text: 'June 12' },
      { type: 'text', out: false, text: 'Код для входа в Ваш аккаунт: 47291. Не давайте его никому!', time: '21:14' },
    ],
  },
  {
    id: 'lera',
    name: 'Лера',
    avatar: 'linear-gradient(135deg,#ff5f8f,#ff9a9e)',
    avatarText: 'Л',
    date: 'Jun 11',
    preview: 'спокойной ночи 🌙',
    type: 'private',
    status: 'online',
    username: 'lera_sun',
    messages: [
      { type: 'date', text: 'June 11' },
      { type: 'text', out: false, text: 'ты уже спишь?', time: '23:58' },
      { type: 'text', out: true, text: 'почти 😴', time: '23:59', status: 'read' },
      { type: 'text', out: false, text: 'спокойной ночи 🌙', time: '00:00' },
      { type: 'sticker', out: true, emoji: '🥰', time: '00:01', status: 'read' },
    ],
  },
  {
    id: 'habr',
    name: 'Хабр',
    avatar: 'linear-gradient(135deg,#2c3e50,#4ca1af)',
    avatarText: 'H',
    date: 'Jun 11',
    preview: 'Как мы переписали бэкенд на Rust…',
    verified: true,
    type: 'channel',
    status: '128 904 subscribers',
    muted: true,
    messages: [
      { type: 'date', text: 'June 11' },
      { type: 'text', out: false, text: '📰 Как мы переписали бэкенд на Rust и снизили latency в 4 раза', time: '12:00' },
      { type: 'text', out: false, text: 'Большая статья от команды инфраструктуры — внутри бенчмарки и грабли.', time: '12:00' },
    ],
  },
  {
    id: 'gym',
    name: 'Зал',
    avatar: 'linear-gradient(135deg,#11998e,#38ef7d)',
    avatarEmoji: '💪',
    date: 'Jun 10',
    preview: 'Тренер: завтра ноги, не опаздывайте',
    type: 'group',
    status: '15 members',
    messages: [
      { type: 'date', text: 'June 10' },
      { type: 'text', sender: 'Тренер', senderColor: C.orange, text: 'Завтра ноги, не опаздывайте 🦵', time: '19:00' },
      { type: 'text', sender: 'Костя', senderColor: C.blue, text: 'опять ноги 😩', time: '19:05' },
      { type: 'text', out: true, text: 'буду как штык', time: '19:10', status: 'read' },
    ],
  },
  {
    id: 'telescope',
    name: 'Telescope',
    avatar: 'linear-gradient(135deg,#2a2a2a,#000)',
    avatarEmoji: '👁',
    date: 'May 8',
    preview: '🎉 Welcome to Telescope! 🔭 Teles…',
    type: 'channel',
    status: '1 203 subscribers',
    messages: [
      { type: 'date', text: 'May 8' },
      { type: 'text', out: false, text: '🎉 Welcome to Telescope! 🔭 Here you can record and share video messages.', time: '09:00' },
    ],
  },
  {
    id: 'mama',
    name: 'Мама',
    avatar: 'linear-gradient(135deg,#f857a6,#ff5858)',
    avatarText: 'М',
    date: 'May 8',
    preview: 'позвони как сможешь',
    type: 'private',
    status: 'last seen yesterday',
    username: 'mama',
    messages: [
      { type: 'date', text: 'May 8' },
      { type: 'text', out: false, text: 'Сынок, поел?', time: '14:00' },
      { type: 'text', out: true, text: 'да мам, всё хорошо 🙂', time: '14:30', status: 'read' },
      { type: 'text', out: false, text: 'позвони как сможешь', time: '14:31' },
    ],
  },
  {
    id: 'sexpedition',
    name: 'Геймпедиция',
    avatar: 'linear-gradient(135deg,#202020,#000)',
    avatarEmoji: '🎮',
    date: 'May 7',
    preview: '🦝 А давненько я вам ничего эд…',
    muted: true,
    type: 'channel',
    status: '32 410 subscribers',
    messages: [
      { type: 'date', text: 'May 7' },
      { type: 'text', out: false, text: '🦝 А давненько я вам ничего эдакого не присылал. Исправляюсь!', time: '20:00' },
    ],
  },
  {
    id: 'mash',
    name: 'Mash',
    avatar: 'linear-gradient(135deg,#ed213a,#93291e)',
    avatarText: 'M',
    date: 'May 7',
    preview: '🚨 Срочная новость дня…',
    verified: true,
    type: 'channel',
    status: '2 104 882 subscribers',
    muted: true,
    messages: [
      { type: 'date', text: 'May 7' },
      { type: 'text', out: false, text: '🚨 Срочно: подробности — в нашем репортаже.', time: '08:30' },
    ],
  },
  {
    id: 'kostya',
    name: 'Костя',
    avatar: 'linear-gradient(135deg,#4facfe,#00f2fe)',
    avatarText: 'К',
    date: 'Mar 14',
    preview: 'го в выходные на рыбалку',
    type: 'private',
    status: 'last seen recently',
    username: 'kostya_fish',
    messages: [
      { type: 'date', text: 'March 14' },
      { type: 'text', out: false, text: 'го в выходные на рыбалку', time: '11:00' },
      { type: 'sticker', out: true, emoji: '🎣', time: '11:05', status: 'read' },
    ],
  },
  {
    id: 'deleted',
    name: 'Deleted Account',
    avatar: 'linear-gradient(135deg,#a8b3c0,#7d8a99)',
    avatarEmoji: '👻',
    date: 'Mar 14',
    preview: '📣 Наши каналы:',
    type: 'private',
    status: 'last seen a long time ago',
    messages: [
      { type: 'date', text: 'March 14' },
      { type: 'text', out: false, text: '📣 Наши каналы:', time: '10:00' },
    ],
  },
  {
    id: 'saved',
    name: 'Saved Messages',
    avatar: 'linear-gradient(135deg,#9a7ff0,#6f8df5)',
    avatarEmoji: '🔖',
    date: 'Mar 14',
    preview: '📂 🦝 Album, Голова: Миюки S24 …',
    type: 'saved',
    status: '',
    messages: [
      { type: 'date', text: 'March 14' },
      { type: 'text', out: true, text: '📂 Album, Голова: Миюки S24', time: '12:00', status: 'read' },
      { type: 'text', out: true, text: 'не забыть купить подарок', time: '12:01', status: 'read' },
    ],
  },
  {
    id: 'premium',
    name: 'Premium Bot',
    avatar: 'linear-gradient(135deg,#b06bff,#6f8df5)',
    avatarEmoji: '⭐',
    date: '11/2/2025',
    preview: 'Оплатите счёт выше, чтобы полу…',
    verified: true,
    type: 'bot',
    status: 'bot',
    username: 'PremiumBot',
    messages: [
      { type: 'date', text: 'November 2' },
      { type: 'text', out: false, text: 'Оплатите счёт выше, чтобы получить Telegram Premium ⭐', time: '15:00' },
    ],
  },

  // ── News channels ──────────────────────────────────────────────
  {
    id: 'ria',
    name: 'РИА Новости',
    avatar: 'linear-gradient(135deg,#1e6bd6,#0a3a8a)',
    avatarText: 'Р',
    date: '09:42',
    preview: '⚡️ Центробанк сохранил ключевую ставку на уровне 16%',
    verified: true,
    type: 'channel',
    status: '4 218 905 subscribers',
    muted: true,
    unread: 48,
    messages: [
      { type: 'date', text: 'Today' },
      { type: 'text', out: false, text: '⚡️ Центробанк сохранил ключевую ставку на уровне 16% годовых', time: '09:42' },
      { type: 'text', out: false, text: 'Курс доллара на открытии торгов опустился ниже 90 рублей', time: '09:50' },
      { type: 'text', out: false, text: '🌦 Синоптики предупредили о резком похолодании в выходные', time: '10:15' },
      { type: 'text', out: false, text: 'В Москве открыли три новые станции метро', time: '11:03' },
      { type: 'text', out: false, text: '🚀 Запуск ракеты «Союз» перенесли на завтра из-за погоды', time: '12:20' },
      { type: 'text', out: false, text: 'Минцифры запустило обновление портала Госуслуг', time: '13:48' },
      { type: 'text', out: false, text: '⚡️ Подписан закон о цифровом рубле', time: '14:30' },
    ],
  },
  {
    id: 'rbc',
    name: 'РБК',
    avatar: 'linear-gradient(135deg,#1a1a1a,#3a3a3a)',
    avatarText: 'Р',
    date: '08:30',
    preview: 'Акции технологических компаний выросли на 4%',
    verified: true,
    type: 'channel',
    status: '2 904 117 subscribers',
    muted: true,
    messages: [
      { type: 'date', text: 'Today' },
      { type: 'text', out: false, text: '📈 Индекс Мосбиржи прибавил 1,8% на старте недели', time: '08:30' },
      { type: 'text', out: false, text: 'Акции технологических компаний выросли на 4% за неделю', time: '09:10' },
      { type: 'text', out: false, text: '💼 Крупная IT-компания объявила о выходе на IPO', time: '10:25' },
      { type: 'text', out: false, text: 'Нефть Brent торгуется выше $82 за баррель', time: '11:40' },
      { type: 'text', out: false, text: '🏦 Банки повысили ставки по вкладам до 18%', time: '13:05' },
      { type: 'text', out: false, text: 'Эксперты прогнозируют рост рынка электрокаров в России', time: '15:12' },
    ],
  },
  {
    id: 'meduza',
    name: 'Meduza',
    avatar: 'linear-gradient(135deg,#3a6fd6,#7b6cf0)',
    avatarText: 'M',
    date: 'Jun 12',
    preview: 'Большой разбор недели: что произошло',
    verified: true,
    type: 'channel',
    status: '1 102 348 subscribers',
    muted: true,
    messages: [
      { type: 'date', text: 'June 12' },
      { type: 'text', out: false, text: '🗞 Большой разбор недели: что произошло и почему это важно', time: '12:00' },
      { type: 'text', out: false, text: 'Как устроена новая реформа — объясняем за 5 минут', time: '14:30' },
      { type: 'text', out: false, text: '🎧 Новый выпуск подкаста уже вышел', time: '18:00' },
    ],
  },
  {
    id: 'tjournal',
    name: 'Хайтек',
    avatar: 'linear-gradient(135deg,#ff7b54,#ff3d77)',
    avatarText: 'Х',
    date: 'Jun 11',
    preview: 'Представлен новый флагманский смартфон',
    verified: true,
    type: 'channel',
    status: '655 201 subscribers',
    muted: true,
    messages: [
      { type: 'date', text: 'June 11' },
      { type: 'text', out: false, text: '📱 Представлен новый флагманский смартфон с титановым корпусом', time: '11:20' },
      { type: 'text', out: false, text: 'OpenAI выпустила новую модель — что умеет', time: '13:15' },
      { type: 'text', out: false, text: '🤖 Робот-пылесос научился складывать вещи', time: '16:40' },
      { type: 'text', out: false, text: 'Тест: лучшие наушники 2026 года', time: '19:00' },
    ],
  },

  // ── More private chats ─────────────────────────────────────────
  {
    id: 'igor',
    name: 'Игорь',
    avatar: 'linear-gradient(135deg,#5b86e5,#36d1dc)',
    avatarText: 'И',
    date: 'Jun 12',
    preview: 'скинул проект, глянь на досуге',
    type: 'private',
    status: 'online',
    online: true,
    username: 'igor_dev',
    messages: [
      { type: 'date', text: 'June 12' },
      { type: 'text', out: false, text: 'привет, ты занят?', time: '15:00' },
      { type: 'text', out: true, text: 'не, чё хотел', time: '15:05', status: 'read' },
      { type: 'text', out: false, text: 'скинул проект, глянь на досуге', time: '15:06' },
      { type: 'text', out: false, text: 'вот ссылка https://kyzdar.ai и пиши @kyzdar_manager #срочно', time: '15:07' },
      { type: 'text', out: true, text: 'ок, вечером посмотрю', time: '15:10', status: 'read' },
      { type: 'text', out: true, text: '🔥', time: '15:10', status: 'read' },
      { type: 'text', out: false, text: '👍😎🎮', time: '15:11' },
    ],
  },
  {
    id: 'sonya',
    name: 'Соня',
    avatar: 'linear-gradient(135deg,#ee9ca7,#ffdde1)',
    avatarText: 'С',
    date: 'Jun 11',
    preview: 'спасибо большое! 🌸',
    type: 'private',
    status: 'last seen 2 hours ago',
    username: 'sonya',
    messages: [
      { type: 'date', text: 'June 11' },
      { type: 'text', out: false, text: 'можешь скинуть конспект?', time: '13:20' },
      { type: 'text', out: true, text: 'держи', time: '13:25', status: 'read' },
      { type: 'text', out: false, text: 'спасибо большое! 🌸', time: '13:26' },
    ],
  },
  {
    id: 'dima',
    name: 'Дима',
    avatar: 'linear-gradient(135deg,#4568dc,#b06ab3)',
    avatarText: 'Д',
    date: 'Jun 10',
    preview: 'погнали в субботу',
    type: 'private',
    status: 'last seen recently',
    username: 'dima_z',
    messages: [
      { type: 'date', text: 'June 10' },
      { type: 'text', out: false, text: 'есть планы на выходные?', time: '20:00' },
      { type: 'text', out: true, text: 'пока нет', time: '20:30', status: 'read' },
      { type: 'text', out: false, text: 'погнали в субботу', time: '20:31' },
    ],
  },
  {
    id: 'olya',
    name: 'Оля',
    avatar: 'linear-gradient(135deg,#f857a6,#ff5858)',
    avatarText: 'О',
    date: 'Jun 9',
    preview: 'до встречи!',
    type: 'private',
    status: 'last seen yesterday',
    username: 'olya',
    messages: [
      { type: 'date', text: 'June 9' },
      { type: 'text', out: false, text: 'во сколько завтра?', time: '17:00' },
      { type: 'text', out: true, text: 'к 12 подъеду', time: '17:15', status: 'read' },
      { type: 'text', out: false, text: 'до встречи!', time: '17:16' },
    ],
  },
  {
    id: 'family',
    name: 'Семья',
    avatar: 'linear-gradient(135deg,#ff9966,#ff5e62)',
    avatarText: 'С',
    date: 'Jun 9',
    preview: 'Папа: купи хлеб по дороге',
    type: 'group',
    status: '4 members',
    messages: [
      { type: 'date', text: 'June 9' },
      { type: 'text', sender: 'Мама', senderColor: C.pink, text: 'все дома сегодня?', time: '18:00' },
      { type: 'text', out: true, text: 'я попозже буду', time: '18:05', status: 'read' },
      { type: 'text', sender: 'Папа', senderColor: C.blue, text: 'купи хлеб по дороге', time: '18:10' },
    ],
  },
]

// ---- kyzdar.ai channel feed --------------------------------------------------
// A single text segment inside a post paragraph; `link` renders it as a tg-link.
export interface PostSeg {
  t: string
  link?: boolean
}
export interface ChannelPost {
  id: string
  date?: string // date separator shown above the post
  photo?: { gradient: string; emoji: string; height?: number }
  title?: string
  paras: PostSeg[][]
  reactions: { emoji: string; count?: number; highlighted?: boolean }[]
  views: string
  time: string
}

const seg = (t: string): PostSeg[] => [{ t }]
const link = (t: string): PostSeg => ({ t, link: true })

export const kyzdarPosts: ChannelPost[] = [
  {
    id: 'p-welcome',
    date: 'June 16',
    photo: { gradient: 'linear-gradient(135deg,#8a5bff,#5b8dff)', emoji: '✨' },
    title: 'Добро пожаловать в kyzdar.ai 💜',
    paras: [
      seg('Это официальный канал. Здесь — живые фото, видео, анонсы и расписание.'),
      [
        { t: 'Запись и любые вопросы — только через менеджера: ' },
        link('@kyzdar_manager'),
      ],
      seg('Уважайте друг друга в комментариях. Реклама и спам — бан без предупреждения.'),
    ],
    reactions: [
      { emoji: '🔥', count: 128, highlighted: true },
      { emoji: '❤️', count: 64 },
      { emoji: '👍', count: 21 },
    ],
    views: '3.2K',
    time: '12:30',
  },
  {
    id: 'p-schedule',
    title: '🗓 Расписание на неделю',
    paras: [
      seg('Пн–Чт: 14:00 – 02:00'),
      seg('Пт–Сб: 14:00 – 06:00'),
      seg('Вс: 16:00 – 00:00'),
      [{ t: 'Бронь столиков и записи — заранее у ' }, link('@kyzdar_manager'), { t: '.' }],
    ],
    reactions: [
      { emoji: '👍', count: 42, highlighted: true },
      { emoji: '🙏', count: 9 },
    ],
    views: '2.7K',
    time: '15:05',
  },
  {
    id: 'p-photos',
    date: 'June 17',
    photo: { gradient: 'linear-gradient(135deg,#ff5fa2,#ff8a5b)', emoji: '📸', height: 320 },
    title: 'Новые фото этой недели',
    paras: [
      seg('Свежая подборка уже в канале. Альбом обновляется каждую пятницу.'),
      [{ t: 'Полные альбомы и видео — по ссылке: ' }, link('https://t.me/+6y3783resPU4Y2Ni')],
    ],
    reactions: [
      { emoji: '🔥', count: 311, highlighted: true },
      { emoji: '😍', count: 142 },
      { emoji: '❤️', count: 87 },
    ],
    views: '5.9K',
    time: '19:42',
  },
  {
    id: 'p-promo',
    photo: { gradient: 'linear-gradient(135deg,#42e695,#3bb2b8)', emoji: '🎁' },
    title: 'Акция выходного дня 🎉',
    paras: [
      seg('Весь уикенд — приветственный напиток в подарок каждому гостю по предварительной записи.'),
      [{ t: 'Кодовое слово при бронировании: ' }, link('KYZDAR')],
    ],
    reactions: [
      { emoji: '🥳', count: 76, highlighted: true },
      { emoji: '👍', count: 33 },
    ],
    views: '4.1K',
    time: '11:20',
  },
  {
    id: 'p-important',
    date: 'June 18',
    photo: { gradient: 'linear-gradient(135deg,#3a2b5e,#120d20)', emoji: '🚀', height: 300 },
    title: 'ОЧЕНЬ ВАЖНО!!!',
    paras: [
      [{ t: '🧧 ' }, link('Наш основной канал'), { t: ' заблокировали у большинства подписчиков' }],
      seg('Причина? Алгоритмы решили, что у нас тут запрещёнка. Очень суровый комплимент нашей работе 🤝'),
      [
        { t: 'Но мы не из тех, кто сдаётся после первого раунда. ' },
        link('Новый канал'),
        { t: ' уже создан, весь контент перенесён, работа продолжается в штатном режиме.' },
      ],
      [
        { t: 'ГОСПОДА, ' },
        link('подписывайтесь на наш новый канал'),
        { t: '. Тут мы будем продолжать делать всё ровно то же самое, что делали и до этого.' },
      ],
      seg('Так что жмём по ссылке и продолжаем'),
      [{ t: '👉 ' }, link('https://t.me/+Y4yhqW7nAQcxNDdi')],
    ],
    reactions: [
      { emoji: '⭐', highlighted: true },
      { emoji: '👍', count: 5 },
      { emoji: '❤️', count: 1 },
    ],
    views: '1.5K',
    time: '22:09',
  },
]
