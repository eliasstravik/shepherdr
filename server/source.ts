// A source fills the view model and carries out actions. The live source reads herdr and the CLIs' logs; the demo
// source holds the prototype's fictional world, for side-by-side review and tests.
import type { Action, ActivityAnswer, ActivityAsk, AddSpace, Alert, Chat, Folders, Snapshot, TermScreen, WorktreeAsk } from '../shared/types.ts'

export type SourceEvents = {
  snapshot: []
  chat: [key: string]
  alert: [alert: Alert]
  terminal: [key: string, screen: TermScreen]
  /** a worker's news for the main machine's home space, which keeps every machine's overview */
  news: [n: Overview]
}

/** one piece of another machine's news, as the main machine's home space hears it: its place and one line */
export interface Overview {
  place: string
  line: string
  kind: 'added' | 'ready' | 'need' | 'done' | 'red' | 'stalled' | 'health'
  about?: Record<string, string>
}

export class Emitter<E extends Record<string, unknown[]>> {
  private fns: { [K in keyof E]?: ((...a: E[K]) => void)[] } = {}
  on<K extends keyof E>(ev: K, fn: (...a: E[K]) => void) {
    ;(this.fns[ev] ??= []).push(fn)
    return () => {
      this.fns[ev] = this.fns[ev]!.filter((f) => f !== fn)
    }
  }
  emit<K extends keyof E>(ev: K, ...a: E[K]) {
    for (const f of this.fns[ev] ?? []) f(...a)
  }
}

export interface Source extends Emitter<SourceEvents> {
  readonly kind: 'live' | 'demo'
  snapshot(): Snapshot
  /** Owning agent status, for chat readers such as voice. */
  chatStatus?(key: string): string
  chat(key: string): Chat | undefined
  act(a: Action): Promise<unknown>
  /** an artifact's page, data and what it sent, at a version (its latest when none) */
  artifact(id: string, v?: number): Promise<{ html: string; data?: unknown; sent?: string } | undefined>
  /** the check's picture of an artifact's latest version, for the list */
  artifactThumb(id: string, dark: boolean): Promise<Blob | null>
  /** which chats and terminal are on someone's screen: read them while they are */
  watch(chats: string[], terms: string[]): void
  upload(chat: string, name: string, data: Uint8Array): Promise<string>
  /** a file attached in a chat, by the path its chat line gives; only those, never anything else on the machine */
  attachment(chat: string, path: string): Promise<Blob | null>
  /** a machine's folders, for adding a project: only folders in the human's home on it */
  folders?(machine: string, path: string): Promise<Folders>
  /** add a project from the sidebar, as `shepherdr project add` does (made a new repo first with create); its place */
  addSpace?(req: AddSpace): Promise<{ place: string }>
  /** a task's worktree, read only, for its side panel: its files, a file, its diff against its base, a file's diff,
   *  its pull request. Never anything outside that worktree. */
  worktree?(ask: WorktreeAsk): Promise<unknown>
  /** a chat's activity: a turn's steps, a step's raw output, a background job's steps or output */
  activity?(ask: ActivityAsk): Promise<ActivityAnswer>
  /** a voice call's audio bridge (live) */
  voice?(chat: string, ws: { send(d: ArrayBuffer | string): void; close(): void; buffered?(): number }): { audio(d: ArrayBuffer): void; end(): void }
  /** a Browser panel's link to a task's shared browser (live, with the browser plugin) */
  browser?(task: string, ws: { send(d: string): void; close(): void; buffered?(): number }): { message(d: string): void; end(): void }
  /** One raw core attach per visible terminal. Input is never replayed after reconnect. */
  terminal?(chat: string, ws: { send(d: Uint8Array | string): void; close(): void; buffered(): number }): { message(d: string): void; end(): void }
  /** before it stops: what must not be cut halfway (a merge) finishes; true when it waited for something */
  drain?(): Promise<boolean>
  stop?(): void
}
