// A fictional day for the demo (bun web/demo/serve.ts): Sam, the machines mac-mini and vm, the spaces shop, blog,
// notes and garden-app. Nothing here is real; it fills the same shapes the service sends, so every screen can be
// looked at, and compared with the design, without a single agent running.
import type { Automation, Catalog, Chat, Config, Message, Place, Snapshot, Task } from '../shared/types.ts'

const NOW = Date.now()
const min = 60_000
const hour = 60 * min
const day = 24 * hour
const today = (h: number, m = 0) => new Date(new Date().setHours(h, m, 0, 0)).getTime()

const place = (id: string, name: string, machine: string, x: Partial<Place> = {}): Place => ({ id, name, machine, level: 0, status: 'idle', mode: 'regular', chat: id, ...x })
export const EV = 'p:mac-mini:~'
/** a space's folder: the whole path, and as it shows (its machine's home as ~) */
const at = (folder: string, where = folder.replace(/^\/(Users|home)\/[^/]+/, '~'), x: Partial<Place> = {}): Partial<Place> => ({ folder, where, ...x })
const P = { shop: 'p:mac-mini:shop', blog: 'p:mac-mini:blog', notes: 'p:mac-mini:notes', docs: 'p:mac-mini:docs', garden: 'p:vm:garden-app', vmShop: 'p:vm:shop', vmRoot: 'p:vm:root' }

const task = (id: string, name: string, pl: string, status: Task['status'], x: Partial<Task> = {}): Task => ({ id, name, place: pl, status, state: status, on: pl === P.garden ? 'vm' : 'mac-mini', created: '', age: '', agent: { chat: `${id}/worker`, role: 'worker', cli: pl === P.garden ? 'codex' : 'claude', status: status === 'need' ? 'need' : 'work', running: true, age: '', note: '' }, ...x })

export const tasks: Task[] = [
  task('SHOP-12', 'Faster product search', P.shop, 'ready', { needsAt: NOW - 8 * hour, repo: 'branch', branch: 'task/shop-12', pr: { number: 212, url: 'https://github.com/example/shop/pull/212' }, summary: 'Results show in about 80 ms, down from 400.', proof: 'a-shop12' }),
  task('BLOG-10', 'Fix typo on the About page', P.blog, 'ready', { needsAt: NOW - hour, repo: 'folder', summary: 'Fixed the typo and two more I found on the same page.' }),
  task('NOTES-4', 'Compare supplier quotes', P.notes, 'ready', { needsAt: NOW - 3 * hour, summary: 'Brightpack is cheapest at your volume. Norbox ships fastest.', proof: 'a-quotes' }),
  task('SHOP-14', 'Switch payment provider', P.shop, 'need', { needsAt: NOW - 2 * hour, blocked: 'question', repo: 'branch', report: { msg: 'Which provider, Stripe or Adyen?', progress: 35, paused: true } }),
  task('vm:GARDEN-4', 'Photo upload', P.garden, 'need', { agent: { chat: 'vm:GARDEN-4/worker', role: 'worker', cli: 'claude', status: 'need', running: true, age: '', note: '' }, needsAt: NOW - 5 * min, blocked: 'permission', repo: 'branch', report: { msg: 'Wants to run a command', progress: 80, paused: true } }),
  task('SHOP-17', "Download last month's invoices", P.shop, 'need', { needsAt: NOW - 4 * min, blocked: 'auth', report: { msg: 'Needs your hands: enter the sign-in code', progress: 20, paused: true } }),
  task('SHOP-15', 'Bigger checkout button on phones', P.shop, 'work', { started: NOW - 10 * min, repo: 'branch', pr: { number: 214, url: 'https://github.com/example/shop/pull/214' }, report: { msg: 'Changing the button', progress: 50, eta: 13 }, blocked: 'prompt' }),
  task('SHOP-16', 'Dependency check', P.shop, 'work', { started: NOW - 10 * min, schedule: 'Dependency check', report: { msg: 'Updating 3 packages', progress: 85, eta: 2 } }),
  task('vm:GARDEN-3', 'Watering reminders', P.garden, 'work', { started: NOW - 30 * min, repo: 'branch', report: { msg: 'Writing tests', progress: 25, eta: 110 } }),
  // SHEP-321: a task just started (no % yet: the turning ring) and one stopped by an error part way
  task('SHOP-18', 'Product page copy', P.shop, 'work', { started: NOW - 2 * min, report: { msg: 'Reading the product pages' } }),
  task('BLOG-11', 'Newsletter signup form', P.blog, 'need', { needsAt: NOW - 12 * min, stopped: { by: 'error', why: 'its session ended' }, report: { msg: 'Adding the form', progress: 45, paused: true } }),
  task('BLOG-9', 'Dark mode for code blocks', P.blog, 'queued', { afterTitle: 'Fix typo on the About page', desc: 'Adds a dark theme to the code blocks on the blog', agent: undefined }),
  task('SHOP-13', 'Gift cards at checkout', P.shop, 'todo', { desc: 'Lets shoppers pay with a gift card at checkout', agent: undefined }),
  task('NOTES-5', "Sort last year's notes", P.notes, 'todo', { desc: "Sorts last year's notes into folders by topic", agent: undefined }),
  task('SHOP-10', 'Look for stuck work', P.shop, 'done', { doneAt: NOW - 18 * min, quiet: 'nothing', schedule: 'Look for stuck work' }),
  task('SHOP-9', 'Look for stuck work', P.shop, 'done', { doneAt: NOW - 48 * min, quiet: 'nothing', schedule: 'Look for stuck work' }),
  task('EV-12', 'Morning brief', EV, 'done', { doneAt: NOW - 4 * hour, quiet: 'told', doneNote: 'told you in Everything', schedule: 'Morning brief' }),
  task('BLOG-6', 'Broken link check', P.blog, 'done', { doneAt: NOW - 9 * hour, merged: true, doneNote: '1 link fixed', schedule: 'Broken link check' }),
  task('SHOP-11', 'Fix cart rounding', P.shop, 'done', { doneAt: NOW - 7 * day, merged: true }),
  task('BLOG-8', 'New post template', P.blog, 'done', { doneAt: NOW - 7 * day, merged: true }),
  task('BLOG-7', 'Faster image loading', P.blog, 'done', { doneAt: NOW - 7 * day, merged: true }),
]

const sched = (id: string, name: string, pl: string, when: string, nextWords: string, last: string, what: string, x: Partial<Automation> = {}): Automation => ({ id, name, place: pl, when, what, on: true, next: [], nextWords, last, ...x })
export const automations: Record<string, Automation[]> = {
  [EV]: [sched('EV-S1', 'Morning brief', EV, 'Every day 7:30', 'tomorrow 7:30', 'today 7:30 · 3 ready, 1 question', 'Tell me what needs me today.'), sched('EV-S2', 'Renew the domain', EV, 'Once · Fri 27 Nov 9:00', '', '', "Remind me to renew the shop's domain.", { once: true })],
  [P.shop]: [
    sched('SHOP-S2', 'Update the changelog', P.shop, 'When a task is merged', '', 'last week, after Fix cart rounding merged', 'Add the merged task to the changelog.'),
    sched('SHOP-S3', 'Look for stuck work', P.shop, 'Every 30 minutes', 'in 12 min', '10:30 · nothing to do', 'Look over #shop. If something is stuck or failing, deal with it or tell me.', { runs: [{ at: NOW - 18 * min, task: 'SHOP-10' }, { at: NOW - 48 * min, task: 'SHOP-9' }] }),
    sched('SHOP-S1', 'Dependency check', P.shop, 'Mondays 9:00', 'in 7 days', 'today 9:00 · 3 packages behind, updating', 'Check for outdated packages and tell me what you find.', { runs: [{ at: today(9), task: 'SHOP-16' }] }),
  ],
  [P.blog]: [sched('BLOG-S1', 'Broken link check', P.blog, 'Every night 2:00', 'in 9h', 'last night 2:00 · 1 link fixed', 'Check every link on the site and fix the broken ones.', { runs: [{ at: today(2), task: 'BLOG-6' }] })],
}

const art = (id: string, title: string, pl: string, at: number, x: Record<string, unknown> = {}) => ({ id, title, place: pl, v: 3, at, when: '', by: '', keeper: '', versions: [{ n: 3, at, when: '', by: '', html: 1 }, { n: 2, at: at - 4 * day, when: '', by: '', html: 1 }, { n: 1, at: at - 7 * day, when: '', by: '', html: 1 }], ...x })
export const artifacts = [
  art('a-quotes', 'Supplier quotes compared', P.notes, NOW - 3 * hour, { task: 'NOTES-4', proof: true }),
  art('a-plan', 'Holiday sale plan', P.shop, NOW - 2 * day),
  art('a-mock', 'Checkout mock-up', P.shop, NOW - 2 * day),
  art('a-deck', 'Launch deck', P.blog, NOW - 7 * day),
  art('a-csv', 'Sales 2026', P.notes, NOW - 14 * day),
  art('a-shop12', 'Faster product search · Proof', P.shop, NOW - 8 * hour, { task: 'SHOP-12', proof: true }),
] as Snapshot['artifacts']

const cc = (model: string, effort: string) => ({ agent: 'claude', model, effort, fast: false as const, perm: null })
export const config: Config = {
  all: { agents: { Chats: cc('sonnet', 'medium'), Tasks: cc('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-5.5-codex', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true },
  spaces: { [P.shop]: { agents: { Chats: cc('sonnet', 'medium'), Tasks: cc('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-5.5-codex', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true, own: ['agents.Tasks'] } },
  secrets: [{ name: 'GITHUB_TOKEN', scope: 'all' }, { name: 'STRIPE_KEY', scope: P.shop }],
  plugins: [['tasks', 'Tasks', true], ['artifacts', 'Artifacts', true], ['terminal', 'Terminal', false], ['screens', 'Screens', false], ['voice', 'Voice', false], ['schedules', 'Schedules', false], ['reactions', 'Reactions', false], ['search', 'Search', true], ['alerts', 'Alerts', true]].map(([id, name, always]) => ({ id: id as string, name: name as string, on: true, ...(always ? { always: true } : {}) })),
  plans: [{ name: 'Claude Max', windows: [{ name: 'This week', used: 76, resets: 'Resets Monday 9:00' }, { name: 'These 5 hours', used: 40, resets: 'Resets in 2 h' }] }, { name: 'Codex Pro', windows: [{ name: 'This week', used: 12, resets: 'Resets Thursday' }] }],
  addMachine: 'hc machine add <name>',
  desktops: ['mac-mini'],
}

const R1 = ['regular']
const m = (id: string, name: string, speeds = R1, group?: string) => ({ id, name, speeds, ...(group ? { group } : {}) })
export const catalog = (machine: string): Catalog => ({
  machine,
  agents: [
    { id: 'claude', name: 'Claude Code', installed: true, models: [m('fable', 'Fable 5.2'), m('opus', 'Opus 5.5', ['regular', 'fast']), m('opus1m', 'Opus 5.5 · 1M'), m('sonnet', 'Sonnet 5.5', ['regular', 'fast']), m('haiku', 'Haiku 5.5')], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], perms: [{ id: 'default', label: 'Default', about: 'Asks before edits and commands' }, { id: 'acceptEdits', label: 'Accept edits', about: 'Edits files without asking' }, { id: 'plan', label: 'Plan', about: 'Plans first and changes nothing' }, { id: 'auto', label: 'Auto', about: 'Decides by itself what is safe to run' }, { id: 'bypass', label: 'Bypass', about: 'Never asks' }], permDefault: 'default', defaultModel: 'sonnet', defaultEffort: 'medium' },
    { id: 'codex', name: 'Codex', installed: true, models: [m('gpt-5.5-codex', 'GPT-5.5 Codex', ['regular', 'fast', 'ultrafast']), m('gpt-5.5', 'GPT-5.5', ['regular', 'fast']), m('gpt-5.5-mini', 'GPT-5.5 mini')], efforts: ['low', 'medium', 'high', 'xhigh'], perms: [{ id: 'read-only', label: 'Read only', about: 'Reads, and asks before anything else' }, { id: 'auto', label: 'Auto', about: 'Works in the folder, asks before leaving it' }, { id: 'full', label: 'Full access', about: 'Never asks' }], permDefault: 'auto', defaultModel: 'gpt-5.5-codex', defaultEffort: 'high' },
    { id: 'opencode', name: 'OpenCode', installed: true, models: [...['Fable 5.2', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'].map((n) => m(`a-${n}`, n, R1, 'Anthropic')), ...['GPT-5.5', 'GPT-5.5 Codex', 'GPT-5.5 mini'].map((n) => m(`o-${n}`, n, R1, 'OpenAI')), ...['Gemini 3 Pro', 'Gemini 3 Flash'].map((n) => m(`g-${n}`, n, R1, 'Google')), ...['Grok 5', 'Grok 5 Fast'].map((n) => m(`x-${n}`, n, R1, 'xAI')), ...['DeepSeek V4', 'Kimi K3', 'Qwen 4 Coder', 'GLM 5', 'Mistral Large 3'].map((n) => m(`r-${n}`, n, R1, 'OpenRouter')), ...['Qwen Coder 32B', 'Llama 5 70B'].map((n) => m(`l-${n}`, n, R1, 'On this machine'))], efforts: [], perms: [{ id: 'ask', label: 'Ask', about: 'Asks before edits and commands' }, { id: 'all', label: 'Allow all', about: 'Never asks' }], permDefault: 'ask' },
    { id: 'pi', name: 'Pi', installed: true, models: [m('p-s', 'Sonnet 5.5', R1, 'Anthropic'), m('p-o', 'Opus 5.5', R1, 'Anthropic'), m('p-g', 'GPT-5.5', R1, 'OpenAI'), m('p-ge', 'Gemini 3 Pro', R1, 'Google')], efforts: ['low', 'medium', 'high'], perms: [] },
    ...['Aider', 'Amp', 'Cline', 'Copilot CLI', 'Crush', 'Cursor Agent', 'Droid', 'Gemini CLI', 'goose', 'Grok Build', 'Kilo Code', 'Kiro', 'Qwen Code'].map((name) => ({ id: name.toLowerCase().replace(/\s+/g, '-'), name, installed: false, models: [], efforts: [], perms: [] })),
  ],
})

export function snapshot(mode: 'normal' | 'empty' | 'down' | 'more' = 'normal'): Snapshot {
  const empty = mode === 'empty'
  const down = mode === 'down'
  return {
    demo: true,
    terminalTransport: 'core',
    name: 'Shepherdr',
    host: 'mac-mini',
    user: 'Sam',
    everything: EV,
    // two spaces called shop, in other folders on other machines, and one deep folder (SHEP-302); a space at the root (SHEP-316)
    places: [place(EV, 'home', 'mac-mini', at('/Users/sam', '~', { home: true })), place(P.shop, 'shop', 'mac-mini', at('/Users/sam/dev/shop')), place(P.blog, 'blog', 'mac-mini', at('/Users/sam/dev/blog')), place(P.notes, 'notes', 'mac-mini', at('/Users/sam/notes')), place(P.docs, 'docs', 'mac-mini', at('/Users/sam/dev/clients/northwind/website-redesign-2026/docs')), place(P.garden, 'garden-app', 'vm', at('/home/sam/dev/garden-app')), place(P.vmShop, 'shop', 'vm', at('/home/sam/clients/acme/shop')), place(P.vmRoot, 'root', 'vm', at('/'))],
    sections: [{ id: 's:store', name: 'Store', machine: 'mac-mini', spaces: [P.shop, P.blog] }],
    machines: [
      { id: 'm:mac-mini', machine: 'mac-mini', name: 'mac-mini', status: 'idle', here: true, health: { meters: [{ name: 'CPU', pct: 34, detail: '', level: 'ok' }, { name: 'Memory', pct: 71, detail: '', level: 'ok' }, { name: 'Disk', pct: 58, detail: '', level: 'ok' }], herdr: true, working: 5, held: 0, at: '' } },
      { id: 'm:vm', machine: 'vm', name: 'vm', status: down ? 'off' : 'idle', ...(down ? { unreachableSince: '14:02' } : {}), health: { meters: [{ name: 'CPU', pct: 12, detail: '', level: 'ok' }, { name: 'Memory', pct: 40, detail: '', level: 'ok' }, { name: 'Disk', pct: empty ? 40 : 91, detail: '', level: 'over' }], herdr: true, working: 2, held: 0, at: '' } },
    ],
    tasks: empty ? [] : tasks,
    automations: empty ? {} : automations,
    artifacts: empty ? [] : artifacts,
    asks: {},
    needs: [],
    settings: [],
    config,
    warnings: empty ? [] : down ? [{ id: 'm:vm', kind: 'machine', text: "Can't reach vm · last seen 14:02" }] : [{ id: 'u:claude', kind: 'usage', text: "You've used 76% of this week's Claude plan" }, { id: 'm:vm', kind: 'machine', text: 'vm: disk nearly full' }, ...(mode === 'more' ? [{ id: 'u:codex', kind: 'usage' as const, text: "You've used 81% of your Codex plan" }] : [])],
    screens: empty ? {} : {
      'task:SHOP-17': { b: { url: 'https://billing.example.com/login' }, d: { of: 'mac-mini', own: false, busy: 'Bigger checkout button on phones' }, active: true, driver: 'agent', hands: { what: 'Enter the sign-in code' } },
      'task:SHOP-15': { b: { url: 'http://localhost:3000/checkout' }, d: { of: 'mac-mini', own: false }, active: true, driver: 'agent' },
      'task:vm:GARDEN-3': { d: { of: 'vm', own: true }, active: true, driver: 'agent' },
      'machine:mac-mini': { d: { of: 'mac-mini', own: false, busy: 'Bigger checkout button on phones' } },
    },
    off: [],
  }
}

let n = 0
const a = (text: string, x: Partial<Message> = {}): Message => ({ id: `m${++n}`, who: 'agent', text, ...x })
const me = (text: string, x: Partial<Message> = {}): Message => ({ id: `m${++n}`, who: 'you', text, ...x })
const did = (at: number, rows: [string, string, string][], summary?: string): Message => ({ id: `m${++n}`, who: 'agent', activity: { id: `a${n}`, at, end: at + 1000, steps: rows.length, ...(summary ? { summary } : {}), rows: rows.map(([kind, text, x], i) => ({ key: `${n}:${i}`, kind: kind as 'run', text, steps: ['s'], ...(x.startsWith('+') ? { added: Number(x.slice(1).split(' ')[0]), removed: Number((x.split('−')[1] ?? '0')) || undefined } : {}) })) } })
const ask = (id: string, title: string, by: { ref: string; title: string; chat: string } | undefined, choices: string[], x: Record<string, unknown> = {}): Message => ({ id: `ask:${id}`, who: 'agent', question: { id, title, kind: 'Question', choices: choices.map((label) => ({ label })), to: '', ...(by ? { by } : {}), ...x } })

const byPay = { ref: 'SHOP-14', title: 'Switch payment provider', chat: 'SHOP-14/worker' }
const byPhoto = { ref: 'GARDEN-4', title: 'Photo upload', chat: 'vm:GARDEN-4/worker' }
const chat = (key: string, messages: Message[], agent: Chat['agent'], x: Partial<Chat> = {}): Chat => ({ key, messages, cli: agent?.kind ?? 'claude', top: true, agent, ...x })
const sonnet = { kind: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5.5', effort: 'medium' }
const opus = { kind: 'claude', model: 'opus', modelLabel: 'Opus 5.5', effort: 'high' }
const gpt = { kind: 'codex', model: 'gpt-5.5-codex', modelLabel: 'GPT-5.5 Codex', effort: 'high' }
const payQ = () => [a("Which provider should I switch to, Stripe or Adyen? I'd go with Stripe."), ask('q-pay', '', undefined, ['Stripe', 'Adyen'])]
const permQ = (by?: typeof byPhoto) => [a('I need an image library to resize the photos.'), ask('q-pil', 'Run a command', by, ['Allow once', 'Decline'], { command: 'pip install pillow' })]

export const chats: Record<string, Chat> = Object.fromEntries(
  [
    chat(EV, [
      a('Morning, Sam. GARDEN-3 is still in progress. Three things are ready for you:', { at: today(7, 30), suggest: 'Show me what needs me' }),
      me('', { at: today(9, 11), file: { name: 'supplier-quotes-november.pdf', path: '/demo/supplier-quotes-november.pdf' } }),
      me('Nice. Add a task to make the checkout button bigger on phones.', { at: today(9, 12), reactions: [{ emoji: '👀', by: 'them' }] }),
      a('Added SHOP-15 to #shop and started it.', { at: today(9, 12) }),
      did(today(9, 12), [['run', 'herdr-task add', 'SHOP-15'], ['run', 'herdr-task start', 'SHOP-15']]),
      a("I'll tell you here when it's ready.", { at: today(9, 13) }),
      { id: `m${++n}`, who: 'agent', news: { task: 'SHOP-14', ref: 'SHOP-14', mark: 'needs', what: '', text: "Which provider should I switch to, Stripe or Adyen? I'd go with Stripe." } },
      ask('q-pay', '', byPay, ['Stripe', 'Adyen']),
      { id: `m${++n}`, who: 'agent', news: { task: 'vm:GARDEN-4', ref: 'GARDEN-4', mark: 'needs', what: '', text: 'I need an image library to resize the photos.' } },
      ask('q-pil', 'Run a command', byPhoto, ['Allow once', 'Decline'], { command: 'pip install pillow' }),
      a('SHOP-16 started on its schedule in #shop. It found 3 packages behind and is updating them.', { suggest: 'Show me what needs me' }),
    ], sonnet),
    chat(P.shop, [a('I made a mock-up of the new checkout. Have a look.'), { id: `m${++n}`, who: 'agent', artifact: { id: 'a-mock', v: 3 } }, a('Started SHOP-15, added from Everything.'), { id: `m${++n}`, who: 'agent', news: { task: 'SHOP-14', ref: 'SHOP-14', mark: 'needs', what: '', text: "Which provider should I switch to, Stripe or Adyen? I'd go with Stripe." } }, ask('q-pay', '', byPay, ['Stripe', 'Adyen']), a('SHOP-16 started on its schedule in #shop. It found 3 packages behind and is updating them.', { suggest: 'How is the checkout button going?' })], sonnet),
    // working, nothing written yet: the working sign alone (SHEP-313)
    chat(P.blog, [a('To see it yourself, run this in the blog folder:\n\n```\nbun run dev\n```'), me('The link to the archive is broken too. Can you fix it?')], sonnet, { working: true }),
    chat(P.notes, [], sonnet),
    chat(P.garden, [a('GARDEN-3 is in progress, about 20 minutes left.'), { id: `m${++n}`, who: 'agent', news: { task: 'vm:GARDEN-4', ref: 'GARDEN-4', mark: 'needs', what: '', text: 'I need an image library to resize the photos.' } }, ask('q-pil', 'Run a command', byPhoto, ['Allow once', 'Decline'], { command: 'pip install pillow' })], gpt),
    chat('SHOP-14/worker', [a('I compared both for the shop. Stripe is already used for your invoices. Adyen gets cheaper above 50k a month but needs two weeks of paperwork.'), ...payQ().map((x, i) => (i ? x : { ...x, suggest: 'Go with Stripe' }))], opus),
    chat('SHOP-12/worker', [a('Search is done. I added an index and cached the top queries.', { suggest: 'Looks good. Mark it as done and merge' })], opus),
    chat('BLOG-10/worker', [a('Fixed it straight in the blog folder, as this space is set up.')], opus),
    chat('NOTES-4/worker', [a('I read the three quotes in your notes folder and wrote up a comparison.')], opus),
    chat('vm:GARDEN-4/worker', permQ().map((x, i) => (i ? x : { ...x, suggest: 'Allow it once' })), opus),
    chat('SHOP-17/worker', [a("I'm downloading October's invoices. The billing portal sent a sign-in code to your phone, so I need you for this one step.")], opus),
    chat('SHOP-15/worker', [a('Started. Making the checkout button full width on phones.'), did(NOW - 8 * min, [['read', 'Read checkout.css', ''], ['edit', 'Edit checkout.css', '+6 −2'], ['run', 'Run bun test', 'passed'], ['edit', 'Edit checkout.test.ts', '+12']], 'Ran 4 commands · edited 2 files'), a('Changing the button now. About 10 minutes left.', { suggest: 'Show me a screenshot when it is done' })], opus, { working: true, doing: 'Changing the checkout button', live: { id: 'live', at: NOW, rows: [], steps: 0 } }),
    chat('SHOP-16/worker', [a('Updating three packages. None are breaking changes.')], opus, { working: true, live: { id: 'live', at: NOW, rows: [], steps: 0 }, doing: 'Updating 3 packages' }),
    chat('vm:GARDEN-3/worker', [a('Reminders are built. Writing the tests now, about 20 minutes left.')], gpt, { working: true, live: { id: 'live', at: NOW, rows: [], steps: 0 }, doing: 'Writing tests' }),
  ].map((c) => [c.key, c]),
)
void byPay
void byPhoto
