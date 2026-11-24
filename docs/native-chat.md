# A chat in a phone's or watch's own app

What a native app (Shepherdr Wake on a phone and its watch) needs to show a whole chat, write in it and mark it read,
without the page socket. `/api/ws` sends the whole snapshot (~720 KB) on every change and each open chat whole each time
it moves: fine for a browser tab, far too much for a watch. Added in SHEP-447; the code is `service/native-chat.ts`. The
list of what needs the person, and the chats with something new, is the glance feed ([glance.md](glance.md)).

Every call goes through the app's gate like the glance feed: from the tailnet, the machine owner's login, on the
serving machine's tailnet name, with `Origin: https://<name>[:port]` and `x-shepherdr: 1`.

A chat is named by its key: a space's Assistant `p:<space id>` (the glance feed's `spaces[].chat`, `chats[].chat`), a
task's agent `<task id>/worker` (an item's `reply.chat` or `answer.chat`).

## Read: `GET /api/chat?chat=<key>[&before=<id>][&limit=<n>]`

One page of the chat's messages, newest first, text only:

```jsonc
{
  "chat": "p:sp2",
  "messages": [
    { "id": "m5", "who": "you",   "at": 1795506300000, "text": "Teal" },
    { "id": "m3", "who": "agent", "at": 1795506240000, "text": "Blue or teal?", "question": true },
    { "id": "m2", "who": "agent", "at": 1795506200000, "text": "On it. See the page" }
  ],
  "more": true          // older messages are there: ask again with before=<the last id>
}
```

- `limit`: 20 by default, 50 at most. `before`: the oldest `id` you have; the page is the messages before it. A `before`
  the chat no longer has (a new session moved on) gives an empty page with `more: false`: start again without it.
- `text`: plain words, Markdown's marks and link targets off, at most 2000 characters, cut at a word with `…`.
  `question: true`: a card's question (its title); answer it from the glance item's `answer`, or on the phone.
- Left out: the quiet rows the web app folds (a task's brief, messages between agents, tool runs, a secret's box), files
  and pictures. The web app shows them all.
- A chat nobody has open is read from its agent's log the moment you ask (up to a few seconds the first time).
  404: no such chat. 503: the service is still starting.

Poll it only while the chat is on screen; the glance feed says when something new came (`unread`, `chats`, `items`).

## Write: `POST /api/action`

```json
{ "type": "send", "chat": "p:sp2", "text": "Make it teal", "cid": "w-1795506300000", "human": true }
```

`cid`: a fresh id of your own; the message that comes back in the chat carries it. `human: true`: said by the person (only
such a message can take back a merge yes). Answer to a message: add `"reply": "<its id>"`. A new task by voice is a
`send` to the space's Assistant (`spaces[].chat`).

## Mark read: `POST /api/action`

```json
{ "type": "read", "chats": { "p:sp2": 1 } }
```

Marks each named Assistant's chat read (20 at most; the values are not used), on every device: the web app's bold row
goes, and the glance feed's `unread` and `chats` drop it with the next frame. A task's agent's chat has no read mark.
