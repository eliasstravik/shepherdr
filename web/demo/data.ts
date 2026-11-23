// A fictional day for the demo (bun web/demo/serve.ts): Sam, the machines mac-mini, vm, studio and pi, the spaces
// shop, blog, notes and garden-app. Nothing here is real; it fills the same shapes the service sends, so every screen can be
// looked at, and compared with the design, without a single agent running.
import type { Automation, Catalog, Chat, Config, Message, Place, Snapshot, Task } from '../shared/types.ts'

const NOW = Date.now()
const min = 60_000
const hour = 60 * min
const day = 24 * hour
const today = (h: number, m = 0) => new Date(new Date().setHours(h, m, 0, 0)).getTime()

const place = (id: string, name: string, machine: string, x: Partial<Place> = {}): Place => ({ id, name, machine, level: 0, status: 'idle', chat: id, ...x })
export const EV = 'p:mac-mini:~'
/** a space's folder: the whole path, and as it shows (its machine's home as ~) */
const at = (folder: string, where = folder.replace(/^\/(Users|home)\/[^/]+/, '~'), x: Partial<Place> = {}): Partial<Place> => ({ folder, where, ...x })
const P = { shop: 'p:mac-mini:shop', blog: 'p:mac-mini:blog', notes: 'p:mac-mini:notes', docs: 'p:mac-mini:docs', garden: 'p:vm:garden-app', vmShop: 'p:vm:shop', vmRoot: 'p:vm:root', oldSite: 'p:mac-mini:old-site', studioSite: 'p:studio:site', vmPortal: 'p:vm:customer-portal-and-billing-redesign' }

// where a task works (SHEP-325): its space's folder unless it says otherwise; notes and the home folder are no repos
const FOLDER: Record<string, [string, string]> = { [EV]: ['/Users/sam', '~'], [P.shop]: ['/Users/sam/dev/shop', 'shop'], [P.blog]: ['/Users/sam/dev/blog', 'blog'], [P.notes]: ['/Users/sam/notes', 'notes'], [P.garden]: ['/home/sam/dev/garden-app', 'garden-app'], [P.vmShop]: ['/home/sam/clients/acme/shop', 'shop'], [P.vmRoot]: ['/home/sam/clients/acme/shop', 'shop'] }
const work = (folder: string, name: string): Task['work'] => ({ name, folder, short: folder.replace(/^\/(Users|home)\/[^/]+/, '~'), repo: !['~', 'notes'].includes(name) })
const task = (id: string, name: string, pl: string, status: Task['status'], x: Partial<Task> = {}): Task => ({ id, name, place: pl, asked: pl, status, state: status, on: pl === P.garden || pl === P.vmShop || pl === P.vmRoot ? 'vm' : 'mac-mini', created: '', age: '', work: FOLDER[pl] && work(...FOLDER[pl]), ...(FOLDER[pl] ? { taskFolder: FOLDER[pl][0] } : {}), agent: { chat: `${id}/worker`, role: 'worker', cli: pl === P.garden ? 'codex' : 'claude', status: status === 'need' ? 'need' : 'work', running: true, age: '', note: '' }, ...x })

export const tasks: Task[] = [
  // SHEP-348's six states on the repo line: own branch, no PR (SHOP-19); PR checks passed (SHOP-12), failed (SHOP-15),
  // running (GARDEN-3); merged (SHOP-11); in the folder itself (BLOG-10); research, no repo (NOTES-4)
  task('SHOP-12', 'Faster product search', P.shop, 'ready', { needsAt: NOW - 8 * hour, repo: 'branch', worktree: true, branch: 'task/faster-product-search', base: 'main', pr: { number: 212, url: 'https://github.com/example/shop/pull/212', checks: 'passed' }, summary: 'Results show in about 80 ms, down from 400.', proof: 'a-shop12' }),
  task('BLOG-10', 'Fix typo on the About page', P.blog, 'ready', { needsAt: NOW - hour, repo: 'folder', summary: 'Fixed the typo and two more I found on the same page.' }),
  task('NOTES-4', 'Compare supplier quotes', P.notes, 'ready', { needsAt: NOW - 3 * hour, summary: 'Brightpack is cheapest at your volume. Norbox ships fastest.', proof: 'a-quotes' }),
  task('SHOP-14', 'Switch payment provider', P.shop, 'need', { needsAt: NOW - 2 * hour, blocked: 'question', repo: 'branch', report: { msg: 'Which provider, Stripe or Adyen?', progress: 35, paused: true } }),
  task('vm:GARDEN-4', 'Photo upload', P.garden, 'need', { agent: { chat: 'vm:GARDEN-4/worker', role: 'worker', cli: 'claude', status: 'need', running: true, age: '', note: '' }, needsAt: NOW - 5 * min, blocked: 'permission', repo: 'branch', report: { msg: 'Wants to run a command', progress: 80, paused: true } }),
  task('SHOP-17', "Download last month's invoices", P.shop, 'need', { needsAt: NOW - 4 * min, blocked: 'auth', report: { msg: 'Needs your hands: enter the sign-in code', progress: 20, paused: true } }),
  task('SHOP-15', 'Bigger checkout button on phones', P.shop, 'work', { started: NOW - 10 * min, repo: 'branch', worktree: true, branch: 'task/bigger-checkout-button', base: 'main', pr: { number: 214, url: 'https://github.com/example/shop/pull/214', checks: 'failed' }, report: { msg: 'Changing the button', progress: 50, eta: 13 }, blocked: 'prompt' }),
  // asked in Everything, works in shop: #shop's Tasks holds it too (SHEP-325)
  task('EV-14', 'Fix the cart badge count', EV, 'work', { started: NOW - 6 * min, repo: 'branch', work: work(...FOLDER[P.shop]), also: [P.shop], report: { msg: 'Reading the cart code', progress: 20 } }),
  // a repo no space works in: its tag still shows its tasks (SHEP-325)
  task('EV-13', 'New level select', EV, 'need', { needsAt: NOW - 20 * min, repo: 'branch', work: work('/Users/sam/dev/tor-gameboy', 'tor-gameboy'), report: { msg: 'Should locked levels show?' } }),
  task('SHOP-16', 'Dependency check', P.shop, 'work', { started: NOW - 10 * min, schedule: 'Dependency check', report: { msg: 'Updating 3 packages', progress: 85, eta: 2 } }),
  task('vm:ACME-7', 'Shipping rates by region', P.vmRoot, 'todo', { agent: undefined }),
  task('vm:GARDEN-3', 'Watering reminders', P.garden, 'work', { started: NOW - 30 * min, repo: 'branch', worktree: true, branch: 'task/watering-reminders', base: 'main', pr: { number: 31, url: 'https://github.com/example/garden-app/pull/31', checks: 'running' }, report: { msg: 'Writing tests', progress: 25, eta: 110 } }),
  // SHEP-321: a task just started (no % yet: the turning ring) and one stopped by an error part way
  task('SHOP-18', 'Product page copy', P.shop, 'work', { started: NOW - 2 * min, report: { msg: 'Reading the product pages' } }),
  task('BLOG-11', 'Newsletter signup form', P.blog, 'need', { needsAt: NOW - 12 * min, stopped: { by: 'error', why: 'its session ended' }, report: { msg: 'Adding the form', progress: 45, paused: true } }),
  task('SHOP-19', 'Product page reviews', P.shop, 'work', { started: NOW - min, repo: 'branch', worktree: true, branch: 'task/product-page-reviews', base: 'main' }),
  task('BLOG-9', 'Dark mode for code blocks', P.blog, 'queued', { afterTitle: 'Fix typo on the About page', desc: 'Adds a dark theme to the code blocks on the blog', agent: undefined }),
  task('SHOP-13', 'Gift cards at checkout', P.shop, 'todo', { desc: 'Lets shoppers pay with a gift card at checkout', agent: undefined }),
  task('NOTES-5', "Sort last year's notes", P.notes, 'todo', { desc: "Sorts last year's notes into folders by topic", agent: undefined }),
  task('SHOP-10', 'Look for stuck work', P.shop, 'done', { doneAt: NOW - 18 * min, quiet: 'nothing', schedule: 'Look for stuck work' }),
  task('SHOP-9', 'Look for stuck work', P.shop, 'done', { doneAt: NOW - 48 * min, quiet: 'nothing', schedule: 'Look for stuck work' }),
  task('EV-12', 'Morning brief', EV, 'done', { doneAt: NOW - 4 * hour, quiet: 'told', doneNote: 'told you in Everything', schedule: 'Morning brief' }),
  task('BLOG-6', 'Broken link check', P.blog, 'done', { doneAt: NOW - 9 * hour, merged: true, doneNote: '1 link fixed', schedule: 'Broken link check' }),
  task('SHOP-11', 'Fix cart rounding', P.shop, 'done', { doneAt: NOW - 7 * day, merged: true, repo: 'branch', worktree: true, branch: 'task/fix-cart-rounding', base: 'main', pr: { number: 205, url: 'https://github.com/example/shop/pull/205' } }),
  task('BLOG-8', 'New post template', P.blog, 'done', { doneAt: NOW - 7 * day, merged: true }),
  task('BLOG-7', 'Faster image loading', P.blog, 'done', { doneAt: NOW - 7 * day, merged: true }),
  // SHEP-331: more machines, spaces and states for the Tasks filter: a stopped one, a scheduled one, two on vm's shop and root
  task('vm:ACME-3', 'Sync stock from the warehouse', P.vmShop, 'need', { on: 'vm', stopped: { by: 'error', why: 'Its agent is no longer running.' }, needsAt: NOW - 25 * min, repo: 'branch' }),
  task('vm:ACME-4', 'Nightly price export', P.vmShop, 'scheduled', { on: 'vm', desc: 'Exports prices for the shop feed at 02:00', agent: undefined }),
  task('vm:ROOT-2', 'Rotate server logs', P.vmRoot, 'work', { on: 'vm', started: NOW - 6 * min, report: { msg: 'Compressing last week', progress: 30 } }),
  // SHEP-354: a long-named space, more repos (the filter's Repo search shows past eight) and a task whose space was
  // removed (the service gives it no space: the filter must not list a blank one)
  task('vm:PORTAL-2', 'Invoice PDF layout', P.vmPortal, 'work', { on: 'vm', started: NOW - 15 * min, repo: 'branch', work: work('/home/sam/clients/northwind/portal', 'portal'), report: { msg: 'Laying out the line items', progress: 50 } }),
  task('vm:PORTAL-1', 'Billing page tests', P.vmPortal, 'todo', { on: 'vm', agent: undefined, work: work('/home/sam/dev/payments-service', 'payments-service') }),
  task('vm:PORTAL-3', 'Shared button styles', P.vmPortal, 'done', { on: 'vm', doneAt: NOW - 2 * day, merged: true, work: work('/home/sam/dev/design-system', 'design-system') }),
  task('studio:SITE-3', 'Swap the hero image', P.studioSite, 'work', { on: 'studio', started: NOW - 4 * min, repo: 'branch', work: work('/Users/sam/dev/site', 'site'), report: { msg: 'Resizing the images', progress: 60 } }),
  task('studio:SITE-4', 'App store screenshots', P.studioSite, 'todo', { on: 'studio', agent: undefined, work: work('/Users/sam/dev/mobile-app', 'mobile-app') }),
  task('EV-15', 'Old export script', '', 'done', { doneAt: NOW - 3 * day, work: work('/Users/sam/dev/exports', 'exports') }),
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

const art = (id: string, title: string, pl: string, at: number, x: Record<string, unknown> = {}) => ({ id, title, place: pl, v: 3, at, when: '', by: '', keeper: '', versions: [{ n: 3, at, when: '', by: '', html: 1 }, { n: 2, at: at - 4 * day, when: '', by: '', html: 1 }, { n: 1, at: at - 7 * day, when: '', by: '', html: 1 }], thumb: true, ...x })
export const artifacts = [
  art('a-quotes', 'Supplier quotes compared', P.notes, NOW - 3 * hour, { task: 'NOTES-4', proof: true }),
  art('a-plan', 'Holiday sale plan', P.shop, NOW - 2 * day),
  art('a-mock', 'Checkout mock-up', P.shop, NOW - 2 * day),
  art('a-deck', 'Launch deck', P.blog, NOW - 7 * day),
  art('a-csv', 'Sales 2026', P.notes, NOW - 14 * day),
  art('a-picks', 'Garden chair picks', P.shop, NOW - 5 * hour),
  art('a-shop12', 'Faster product search · Proof', P.shop, NOW - 8 * hour, { task: 'SHOP-12', proof: true }),
] as Snapshot['artifacts']

const cc = (model: string, effort: string) => ({ agent: 'claude', model, effort, fast: false as const, perm: null })
export const config: Config = {
  all: { agents: { Chats: cc('sonnet', 'medium'), Tasks: cc('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-5.5-codex', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true },
  spaces: { [P.shop]: { agents: { Chats: cc('fable', 'high'), Tasks: cc('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-5.5-codex', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true, own: ['agents.Chats'] } },
  // SHEP-335: task settings are the repo's a task works in; root on vm sits on /, its tasks work in the acme shop
  repos: [
    { key: '/Users/sam/dev/shop', folder: '/Users/sam/dev/shop', machine: null, name: 'shop', spaces: [P.shop], tasks: 6, agents: { Chats: cc('sonnet', 'medium'), Tasks: cc('opus', 'xhigh'), Reviews: { agent: 'codex', model: 'gpt-5.5-codex', effort: 'high', fast: false, perm: null } }, review: true, merge: 'checks', proof: true, own: ['agents.Tasks', 'review', 'merge'] },
    { key: 'vm:/home/sam/clients/acme/shop', folder: '/home/sam/clients/acme/shop', machine: 'vm', name: 'shop', spaces: [P.vmShop], tasks: 1, agents: { Chats: cc('sonnet', 'medium'), Tasks: cc('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-5.5-codex', effort: 'high', fast: false, perm: null } }, review: false, merge: 'now', proof: true, own: ['merge'] },
    { key: 'vm:/home/sam/dev/garden-app', folder: '/home/sam/dev/garden-app', machine: 'vm', name: 'garden-app', spaces: [P.garden], tasks: 2, agents: { Chats: cc('sonnet', 'medium'), Tasks: cc('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-5.5-codex', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true, own: [] },
    { key: '/Users/sam/dev/blog', folder: '/Users/sam/dev/blog', machine: null, name: 'blog', spaces: [P.blog], tasks: 1, agents: { Chats: cc('sonnet', 'medium'), Tasks: cc('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-5.5-codex', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true, own: [] },
    { key: '/Users/sam/notes', folder: '/Users/sam/notes', machine: null, name: 'notes', spaces: [P.notes], tasks: 1, agents: { Chats: cc('sonnet', 'medium'), Tasks: cc('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-5.5-codex', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: false, own: ['proof'] },
    { key: 'vm:/', folder: '/', machine: 'vm', name: '/', spaces: [P.vmRoot], tasks: 0, agents: { Chats: cc('sonnet', 'medium'), Tasks: cc('opus', 'high'), Reviews: { agent: 'codex', model: 'gpt-5.5-codex', effort: 'high', fast: false, perm: null } }, review: false, merge: 'done', proof: true, own: [] },
  ],
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

// ?case=long: long names everywhere, for checking text gets its room and is cut only where the space ends
const LONG_NAMES: Record<string, string> = {
  'SHOP-15': 'Bigger checkout button on phones, and the same for the cart page and the one-page checkout',
  'SHOP-12': 'Faster product search: results as you type, with typo tolerance and the top sellers first',
  'BLOG-9': 'Dark mode for code blocks, matching the theme the reader picked in their system settings',
}
const longDay = (s: Snapshot): Snapshot => ({
  ...s,
  places: s.places.map((p) => (p.id === P.shop ? { ...p, name: 'shop-storefront-and-checkout' } : p)),
  tasks: s.tasks.map((t) => ({ ...t, ...(LONG_NAMES[t.id] ? { name: LONG_NAMES[t.id] } : {}), ...(t.id === 'BLOG-9' ? { afterTitle: LONG_NAMES['SHOP-12'], afterMore: 5 } : {}) })),
  artifacts: s.artifacts.map((a: any, i: number) => (i === 0 ? { ...a, title: `${a.title}: the whole story, with every screenshot and the numbers behind it` } : a)),
})

export function snapshot(mode: 'normal' | 'empty' | 'down' | 'more' | 'long' = 'normal'): Snapshot {
  if (mode === 'long') return longDay(snapshot('normal'))
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
    places: [place(EV, 'home', 'mac-mini', at('/Users/sam', '~', { home: true })), place(P.shop, 'shop', 'mac-mini', at('/Users/sam/dev/shop', undefined, { git: 'main' })), place(P.blog, 'blog', 'mac-mini', at('/Users/sam/dev/blog')), place(P.notes, 'notes', 'mac-mini', at('/Users/sam/notes')), place(P.docs, 'docs', 'mac-mini', at('/Users/sam/dev/clients/northwind/website-redesign-2026/docs')), place(P.garden, 'garden-app', 'vm', at('/home/sam/dev/garden-app')), place(P.vmShop, 'shop', 'vm', at('/home/sam/clients/acme/shop')), place(P.vmRoot, 'root', 'vm', at('/')),
      // SHEP-342: an archived space for the machines' filter, a machine with one space and one with none
      place(P.oldSite, 'old-site', 'mac-mini', at('/Users/sam/dev/old-site', undefined, { archived: true })), place(P.studioSite, 'site', 'studio', at('/Users/sam/dev/site')),
      // SHEP-354: a space with a long name, for the Tasks filter's width
      place(P.vmPortal, 'customer-portal-and-billing-redesign', 'vm', at('/home/sam/clients/northwind/portal'))],
    sections: [{ id: 's:store', name: 'Store', machine: 'mac-mini', spaces: [P.shop, P.blog] }],
    machines: [
      { id: 'm:mac-mini', machine: 'mac-mini', name: 'mac-mini', status: 'idle', here: true, health: { meters: [{ name: 'CPU', pct: 34, detail: '', level: 'ok' }, { name: 'Memory', pct: 71, detail: '', level: 'ok' }, { name: 'Disk', pct: 58, detail: '', level: 'ok' }], herdr: true, working: 5, held: 0, at: '' } },
      { id: 'm:vm', machine: 'vm', name: 'vm', status: down ? 'off' : 'idle', ...(down ? { unreachableSince: '14:02' } : {}), health: { meters: [{ name: 'CPU', pct: 12, detail: '', level: 'ok' }, { name: 'Memory', pct: 40, detail: '', level: 'ok' }, { name: 'Disk', pct: empty ? 40 : 91, detail: '', level: 'over' }], herdr: true, working: 2, held: 0, at: '' } },
      { id: 'm:studio', machine: 'studio', name: 'studio', status: 'idle' },
      { id: 'm:pi', machine: 'pi', name: 'pi', status: 'idle' },
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

// a task's brief, its chat's first message (SHEP-330): what the shop's Assistant wrote, its Settings folded away
const SETTINGS = ['Review: off', 'Merge: after checks', 'Proof: before and after screenshots', 'Agent: claude, model opus, effort high']
const brief = (title: string, text: string, state: 'waiting' | 'sent' | 'read', at?: number): Message => ({ id: `m${++n}`, who: 'you', text, ...(at ? { at } : {}), taskBrief: { title, text, settings: SETTINGS, from: 'Assistant', state } })
const LONG_BRIEF = [
  "On phones the checkout button is small and sits right under the total, so people tap the total instead. Make it easy to hit.",
  '',
  "Sam's words: \"On my phone I keep missing the pay button. Make it big, the whole width, like other shops do.\"",
  '',
  'Do:',
  '- On screens under 640 px wide, the checkout button spans the full width, 48 px tall, with 16 px around it.',
  '- Keep it where it is on larger screens.',
  '- The button keeps its colour and its words ("Pay now").',
  '- Check the cart page and the one-page checkout; both use the same button.',
  '- Tests: the button is full width at 390 px and unchanged at 1280 px.',
  '- Proof: before and after screenshots on a phone and a laptop.',
  '',
  'Stay inside this change. Do not touch the payment code.',
].join('\n')

const byPay = { ref: 'SHOP-14', title: 'Switch payment provider', chat: 'SHOP-14/worker' }
const byPhoto = { ref: 'GARDEN-4', title: 'Photo upload', chat: 'vm:GARDEN-4/worker' }
/** a message between agents (SHEP-368): one quiet row, in the sender's chat ("to") and the receiver's ("from") */
const relay = (dir: 'to' | 'from', name: string, text: string, at: number, x: Partial<NonNullable<Message['relay']>> = {}): Message =>
  ({ id: `m${++n}`, who: dir === 'to' ? 'agent' : 'you', text, at, brief: { label: `Message ${dir} ${name}` }, relay: { dir, name, ...x } })
const LONG_NOTE = 'The supplier quotes are in. Short version: the second supplier is cheapest per unit but ships in six weeks; the first ships in one.\n\n' +
  'Before the checkout change merges, can you check whether the bigger button still fits the order summary on the smallest phones? The last change pushed the total below the fold on a 360 px screen, and people missed it.\n\n' +
  'Nothing else needs you today. I will tell you here when the quotes task is ready.'
const chat = (key: string, messages: Message[], agent: Chat['agent'], x: Partial<Chat> = {}): Chat => ({ key, messages, cli: agent?.kind ?? 'claude', top: true, agent, ...x })
const sonnet = { kind: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5.5', effort: 'medium' }
const opus = { kind: 'claude', model: 'opus', modelLabel: 'Opus 5.5', effort: 'high' }
const gpt = { kind: 'codex', model: 'gpt-5.5-codex', modelLabel: 'GPT-5.5 Codex', effort: 'high' }
const payQ = () => [a("Which provider should I switch to, Stripe or Adyen? I'd go with Stripe."), ask('q-pay', '', undefined, ['Stripe', 'Adyen'])]
const permQ = (by?: typeof byPhoto) => [a('I need an image library to resize the photos.'), ask('q-pil', 'Run a command', by, ['Allow once', 'Decline'], { command: 'pip install pillow' })]

export const chats: Record<string, Chat> = Object.fromEntries(
  [
    chat(EV, [
      a('Morning, Sam. Watering reminders is still in progress. Three things are ready for you:', { at: today(7, 30), suggest: 'Show me what needs me' }),
      me('', { at: today(9, 11), file: { name: 'supplier-quotes-november.pdf', path: '/demo/supplier-quotes-november.pdf' } }),
      me('Nice. Add a task to make the checkout button bigger on phones.', { at: today(9, 12), reactions: [{ emoji: '👀', by: 'them' }] }),
      a('Added Bigger checkout button on phones to #shop and started it.', { at: today(9, 12), reactions: [{ emoji: '🎉', by: 'me' }] }),
      did(today(9, 12), [['run', 'herdr-task add', '"Bigger checkout button on phones"'], ['run', 'herdr-task start', '"Bigger checkout button on phones"']]),
      a("I'll tell you here when it's ready.", { at: today(9, 13), reactions: [{ emoji: '👍', by: 'me' }] }),
      relay('to', '#root on vm', 'Can you check the disk on the vm? A task there said it is nearly full.', today(9, 14), { how: 'assistant', state: 'delivered' }),
      relay('from', '#shop', LONG_NOTE, today(9, 20), { files: ['supplier-quotes-november.pdf'] }),
      relay('to', '#garden-app on vm', 'The photo task waits on a library. Pillow is fine to install.', today(9, 22), { how: 'assistant', state: 'waiting', why: 'the person is writing to it' }),
      relay('to', 'Assistant on studio', 'Is the site build green again?', today(9, 23), { how: 'assistant', state: 'failed', why: "studio can't be reached" }),
      { id: `m${++n}`, who: 'agent', news: { task: 'SHOP-14', ref: 'SHOP-14', mark: 'needs', what: '', text: "Which provider should I switch to, Stripe or Adyen? I'd go with Stripe." } },
      ask('q-pay', '', byPay, ['Stripe', 'Adyen']),
      { id: `m${++n}`, who: 'agent', news: { task: 'vm:GARDEN-4', ref: 'GARDEN-4', mark: 'needs', what: '', text: 'I need an image library to resize the photos.' } },
      ask('q-pil', 'Run a command', byPhoto, ['Allow once', 'Decline'], { command: 'pip install pillow' }),
      a('Dependency check started on its schedule in #shop. It found 3 packages behind and is updating them.'),
      me('And the sale plan, APP/?artifact=a-plan, still good?'),
      // a reply that quotes a long message, with a short answer: the quote truncates inside the bubble (SHEP-353)
      me('Use /ui to fix', { reply: { text: 'Dependency check started on its schedule in #shop. It found 3 packages behind and is updating them. Supercalifragilisticexpialidociouslylongwordwithoutanybreaks', who: 'agent' }, reactions: [{ emoji: '👍', by: 'them' }] }),
      me('Pinned to https://example.com/releases/2026/november/checkout-redesign-final-final-v2-with-the-bigger-button and Pneumonoultramicroscopicsilicovolcanoconiosis too', { reactions: [{ emoji: '🎉', by: 'both' }] }),
      a('Noted: https://example.com/releases/2026/november/checkout-redesign-final-final-v2-with-the-bigger-button is the one, and Pneumonoultramicroscopicsilicovolcanoconiosis stays.', { reactions: [{ emoji: '👍', by: 'me' }] }),
      // links to the app itself, as `herdr-artifact link` prints them: they open in the app (SHEP-339)
      a('The quotes are compared: [Supplier quotes compared](APP/?artifact=a-quotes). Its task: [Compare supplier quotes](APP/?task=NOTES-4). The [shop space](APP/?place=p:mac-mini:shop). The suppliers\' own site: [example.com](https://example.com/).', { suggest: 'Show me what needs me' }),
    ], sonnet),
    chat(P.shop, [relay('from', 'Everything', LONG_NOTE, today(9, 20) - 2 * min), relay('to', 'Everything', LONG_NOTE, today(9, 20), { how: 'assistant', state: 'delivered' }),
      relay('to', 'Bigger checkout button on phones', 'Keep the total above the fold on a 360 px screen too.', today(9, 25), { how: 'reply', state: 'delivered' }),
      relay('from', 'Bigger checkout button on phones', 'Done: the total stays above the fold at 360 px. Screenshot in my chat.', today(9, 40)),
      relay('to', 'Faster product search', 'Fix what keeps its pull request from merging.', today(9, 41), { how: 'fix', state: 'waiting', why: 'its agent stopped; it goes to its next one' }),
      a('I made a mock-up of the new checkout. Have a look.'), { id: `m${++n}`, who: 'agent', artifact: { id: 'a-mock', v: 3 } }, a('Started SHOP-15, added from Everything.'), { id: `m${++n}`, who: 'agent', news: { task: 'SHOP-14', ref: 'SHOP-14', mark: 'needs', what: '', text: "Which provider should I switch to, Stripe or Adyen? I'd go with Stripe." } }, ask('q-pay', '', byPay, ['Stripe', 'Adyen']), a('SHOP-16 started on its schedule in #shop. It found 3 packages behind and is updating them.', { suggest: 'How is the checkout button going?' })], sonnet),
    // working, nothing written yet: the working sign alone (SHEP-313)
    chat(P.blog, [a('To see it yourself, run this in the blog folder:\n\n```\nbun run dev\n```'), me('The link to the archive is broken too. Can you fix it?', { reactions: [{ emoji: '👍', by: 'both' }] })], sonnet, { working: true, doing: "Running python3 - <<'EOF' p='web/src/archive.ts'" }),
    chat(P.notes, [], sonnet),
    chat(P.garden, [a('GARDEN-3 is in progress, about 20 minutes left.'), { id: `m${++n}`, who: 'agent', news: { task: 'vm:GARDEN-4', ref: 'GARDEN-4', mark: 'needs', what: '', text: 'I need an image library to resize the photos.' } }, ask('q-pil', 'Run a command', byPhoto, ['Allow once', 'Decline'], { command: 'pip install pillow' })], gpt),
    chat('SHOP-14/worker', [a('I compared both for the shop. Stripe is already used for your invoices. Adyen gets cheaper above 50k a month but needs two weeks of paperwork.'), ...payQ().map((x, i) => (i ? x : { ...x, suggest: 'Go with Stripe' }))], opus),
    chat('SHOP-12/worker', [a('Search is done. I added an index and cached the top queries.', { suggest: 'Looks good. Mark it as done and merge' })], opus),
    chat('BLOG-10/worker', [a('Fixed it straight in the blog folder, as this space is set up.')], opus),
    chat('NOTES-4/worker', [a('I read the three quotes in your notes folder and wrote up a comparison.')], opus),
    chat('vm:GARDEN-4/worker', permQ().map((x, i) => (i ? x : { ...x, suggest: 'Allow it once' })), opus),
    chat('SHOP-17/worker', [a("I'm downloading October's invoices. The billing portal sent a sign-in code to your phone, so I need you for this one step.")], opus),
    chat('SHOP-15/worker', [brief('Bigger checkout button on phones', LONG_BRIEF, 'read', NOW - 10 * min), a('Started. Making the checkout button full width on phones.'), relay('from', 'Assistant', 'Keep the total above the fold on a 360 px screen too.', NOW - 9 * min), did(NOW - 8 * min, [['read', 'Read checkout.css', ''], ['edit', 'Edit checkout.css', '+6 −2'], ['run', 'Run bun test', 'passed'], ['edit', 'Edit checkout.test.ts', '+12']], 'Ran 4 commands · edited 2 files'), relay('to', 'Assistant', 'Done: the total stays above the fold at 360 px. Screenshot in my chat.', NOW - 2 * min, { how: 'hc', state: 'delivered' }), a('Changing the button now. About 10 minutes left.', { suggest: 'Show me a screenshot when it is done' })], opus, { working: true, doing: "Running python3 - <<'EOF' p='web/checkout.css'", live: { id: 'live', at: NOW, rows: [], steps: 0 } }),
    // its agent just started: the brief sent, not taken in yet, and words for it starting
    chat('SHOP-19/worker', [brief('Product page reviews', 'Show the three newest reviews under each product, with their stars. A product with none says "No reviews yet."', 'sent', NOW - min)], opus),
    // queued: no agent yet, its brief waits to be sent
    chat('BLOG-9/worker', [brief('Dark mode for code blocks', 'Adds a dark theme to the code blocks on the blog. It follows the reader\'s system setting; no switch on the page.', 'waiting')], undefined),
    chat('SHOP-16/worker', [a('Updating three packages. None are breaking changes.')], opus, { working: true, live: { id: 'live', at: NOW, rows: [], steps: 0 }, doing: 'Updating 3 packages' }),
    chat('vm:GARDEN-3/worker', [a('Reminders are built. Writing the tests now, about 20 minutes left.')], gpt, { working: true, live: { id: 'live', at: NOW, rows: [], steps: 0 }, doing: 'Writing tests' }),
  ].map((c) => [c.key, c]),
)
void byPay
void byPhoto
