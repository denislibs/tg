// Порт tweb `src/components/chat/chatType.ts` (812502980) 1:1. Значение — `data-type`
// контейнера инстанса чата (`.chat.tabs-tab`) в живом DOM tweb.
export enum ChatType {
  Chat = 'chat',
  Pinned = 'pinned',
  Discussion = 'discussion',
  Scheduled = 'scheduled',
  Stories = 'stories',
  Saved = 'saved',
  Search = 'search',
  Static = 'static',
  Logs = 'logs',
  // layer 229: the welcome messages a chat sends each new member (desktop's WelcomeMessages section)
  Welcome = 'welcome',
}
