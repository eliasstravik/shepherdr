// Serve from (core/host.js): which machine serves the web app and holds the truth, as this service sees it. Every
// 15 s it reads the host record here and the host's own (it hands a move on), keeps the newest here and hands it on
// to the machines it links that had an older one (a machine asleep at the move learns it when it wakes), and says
// who it is in its
// own node record (its id, its names for the machines it links, its link). Not the host: the host's node record says
// its names, so the shared data can be moved between the two machines' words.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Hub } from "./hub.ts";
import { HOME, where } from "./paths.ts";
import { buildId } from "./build.ts";

const BUILD = buildId();
import * as HC from "../core/host.js";

const { HOST_DOC, NODE_DOC, WEB_DOC, newestHost, nodeAlive, renamer } = HC as any;

export type Node = { id: string; name: string; os: string; version: string; build?: string; link: string | null; serving: boolean; links: Record<string, string>; remotes: string[]; at: number };
export type MachineRow = { name: string; id: string | null; state: string; here?: boolean };

export class Host {
  /** this machine's herdr-core identity */
  me: { id: string; name: string } | null = null;
  /** the machines this one links: name -> { id, state } */
  machines = new Map<string, { id: string | null; state: string }>();
  /** the host record in force (null: none, each machine serves itself) */
  record: { id: string; at: number; by?: string } | null = null;
  /** the host's node record, when it isn't this machine */
  hostNode: Node | null = null;
  /** every machine's node record that answered, by id (their service runs; os for the picker) */
  nodes = new Map<string, Node>();
  /** this machine's web link (the service's tailnet() sets it) */
  link: string | null = null;
  private listeners = new Set<() => void>();
  private busy = false;
  private said = "";
  private wrote = { text: "", at: 0 };
  /** each machine's system (uname), asked once through herdr-core for one with no node record: by id */
  private systems = new Map<string, string>();

  constructor(private hub: Hub, private version: string) {}

  on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  start() {
    this.hub.on((e) => { if (e.type === "doc" && (e as any).data?.name === HOST_DOC) void this.poll(); });
    setInterval(() => void this.poll(), 15_000);
    return this.poll();
  }

  /** No record, or this machine's: it serves the web app and holds the truth. */
  serving() { return !this.record || !this.me || this.record.id === this.me.id; }

  /** The host's name here (null: this machine; undefined: not linked from here). */
  hubName(): string | null | undefined {
    if (this.serving()) return null;
    for (const [name, m] of this.machines) if (m.id === this.record!.id) return name;
    return undefined;
  }

  /** The host is this machine, or connected now and its service answers. */
  reachable() {
    if (this.serving()) return true;
    const n = this.hubName();
    return typeof n === "string" && this.machines.get(n)?.state === "connected" && nodeAlive(this.hostNode);
  }

  /** This machine's node record (its names for every machine). */
  node(): Node {
    const links: Record<string, string> = {};
    for (const [name, m] of this.machines) if (m.id) links[name] = m.id;
    return { id: this.me?.id ?? "", name: this.me?.name ?? "", os: process.platform, version: this.version, build: BUILD, link: this.link, serving: this.serving(), links,
      remotes: this.remotes().map((n) => links[n]).filter(Boolean), at: Date.now() };
  }

  /** The machines this one's herdr-task has run tasks on (~/.local/share/shepherdr/tasks/.remote/<name>). */
  remotes(): string[] {
    try { return readdirSync(join(where().tasks, ".remote")).filter((x) => /^[\w.-]+$/.test(x) && !x.endsWith(".secret")); } catch { return []; }
  }

  /** Machines with a Shepherdr service of their own, by name here: each does its own machine's work. */
  participants(): Set<string> {
    const out = new Set<string>();
    for (const [name, m] of this.machines) if (m.id && this.nodes.has(m.id)) out.add(name);
    return out;
  }

  /**
   * The other machines whose tasks this service ticks: none but its own while another machine serves and can be
   * reached; the host ticks every machine any service ran tasks on (theirs too), but those with a service of their own.
   */
  tickOn(): string[] {
    if (!this.serving() && this.reachable()) return [];
    const names = new Set(this.remotes());
    if (this.serving()) for (const n of this.nodes.values()) for (const id of n.remotes ?? []) {
      const hit = [...this.machines].find(([, m]) => m.id === id);
      if (hit) names.add(hit[0]);
    }
    const mine = this.participants();
    return [...names].filter((n) => !mine.has(n) && this.machines.get(n)?.state === "connected");
  }

  /** Moves names from this machine's words to the host's, and back. */
  toHost() { return renamer(this.node(), this.hostNode); }
  fromHost() { return renamer(this.hostNode, this.node()); }

  /** Where the web app is: this machine's link, or the host's. */
  hostLink() { return this.serving() ? this.link : this.hostNode?.link ?? null; }

  /** The machines the picker offers: this one, then every linked one, with its state and what it runs. */
  choices(): (MachineRow & { os: string | null; serves: boolean })[] {
    const os = (id: string | null) => (id ? this.nodes.get(id)?.os ?? this.systems.get(id) ?? null : null);
    const hostId = this.record?.id ?? this.me?.id ?? null;
    return [
      { name: this.me?.name ?? "", id: this.me?.id ?? null, state: "connected", here: true, os: process.platform, serves: !this.record || hostId === this.me?.id },
      ...[...this.machines].map(([name, m]) => ({ name, id: m.id, state: m.state, os: os(m.id), serves: !!m.id && m.id === hostId })),
    ];
  }

  private emit() { for (const fn of this.listeners) try { fn(); } catch (err) { console.error(err); } }

  private async get(name: string, on: string | null) {
    return this.hub.call<{ value: any; version: number }>("doc.get", { name, ...(on ? { on } : {}) }, 8000);
  }

  /** Writes the web link record (core/host.js WEB_DOC) on these machines (null: here) where it differs. */
  private async sayLink(on: (string | null)[]) {
    const value = { link: this.link, id: this.me!.id };
    await Promise.all(on.map(async (m) => {
      const d = await this.get(WEB_DOC, m).catch(() => null);
      if (d && d.value?.link === value.link && d.value?.id === value.id) return;
      await this.hub.call("doc.set", { name: WEB_DOC, value, version: d?.version ?? 0, ...(m ? { on: m } : {}) }).catch(() => {});
    }));
  }

  /** Reads and hands on the host record; writes this machine's node record. */
  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      const st = await this.hub.call<any>("server.status", {});
      this.me = { id: String(st?.core?.id ?? ""), name: String(st?.core?.name ?? "") };
      const ml = await this.hub.call<{ machines: any[] }>("machine.list", {});
      this.machines = new Map((ml.machines ?? []).filter((m) => !m.temporary).map((m) => [String(m.name), { id: m.id ? String(m.id) : null, state: String(m.state ?? "") }]));
      const connected = [...this.machines].filter(([, m]) => m.state === "connected").map(([n]) => n);
      // Whom to believe: the record here (whatever can write this machine's documents can run anything here anyway),
      // and a newer one from the machine that serves now (it hands a move on). Never one from any other machine: a box
      // this one only links (a VM running agents) can't make itself the host. A record from the future doesn't count.
      const here = await this.get(HOST_DOC, null).catch(() => null);
      const there = await Promise.all(connected.map(async (m) => ({ m, host: await this.get(HOST_DOC, m).catch(() => null), node: await this.get(NODE_DOC, m).catch(() => null) })));
      this.nodes = new Map(there.filter((t) => nodeAlive(t.node?.value)).map((t) => [String(t.node!.value.id), t.node!.value as Node]));
      const sane = (r: any) => (r && Number(r.at) <= Date.now() + 60_000 && (r.id === this.me!.id || [...this.machines.values()].some((m) => m.id === r.id)) ? r : null);
      const mine = sane(here?.value);
      const nowHost = mine && mine.id !== this.me.id ? there.find((t) => this.machines.get(t.m)?.id === mine.id) : null;
      const best = newestHost([mine, sane(nowHost?.host?.value)]);
      if (best && JSON.stringify(best) !== JSON.stringify(here?.value ?? null))
        await this.hub.call("doc.set", { name: HOST_DOC, value: best, version: here?.version ?? 0 }).catch(() => {});
      // hand it on to each machine this one links whose record is older (one that answered)
      if (best) for (const t of there) if (t.host && (Number(t.host.value?.at) || 0) < best.at)
        await this.hub.call("doc.set", { name: HOST_DOC, value: best, version: t.host.version, on: t.m }).catch(() => {});
      // the host says its web link here and on each machine it links, for agents there (herdr-artifact link)
      if (this.link && (!best || best.id === this.me.id)) await this.sayLink([null, ...connected]);
      // the picker says each machine's system: ask the ones with no service of their own, once
      await Promise.all(there.filter((t) => { const id = this.machines.get(t.m)?.id; return id && !this.nodes.has(id) && !this.systems.has(id); }).map(async (t) => {
        const r = await this.hub.call<{ code: number; stdout: string }>("machine.exec", { on: t.m, argv: ["uname", "-s"], timeout: 10 }, 15_000).catch(() => null);
        const word = r?.code === 0 ? Buffer.from(r.stdout ?? "", "base64").toString().trim().toLowerCase() : "";
        if (word) this.systems.set(this.machines.get(t.m)!.id!, word);
      }));
      this.record = best ? { id: String(best.id), at: Number(best.at), by: best.by } : null;
      this.hostNode = this.serving() ? null : this.nodes.get(this.record!.id) ?? null;
      // who this machine is, for the others: when it changed, else once a minute (so they know the service runs)
      const { at: _at, ...node } = this.node(), text = JSON.stringify(node);
      if (text !== this.wrote.text || Date.now() - this.wrote.at > 60_000) {
        const mine = await this.get(NODE_DOC, null).catch(() => null);
        await this.hub.call("doc.set", { name: NODE_DOC, value: this.node(), version: mine?.version ?? 0 });
        this.wrote = { text, at: Date.now() };
      }
    } catch (err) {
      console.error(`serve from: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
    const now = JSON.stringify([this.record, this.hostNode?.links, this.hostNode?.link, this.reachable(), [...this.machines], [...this.nodes.keys()], [...this.systems]]);
    if (now !== this.said) { this.said = now; this.emit(); }
  }
}
