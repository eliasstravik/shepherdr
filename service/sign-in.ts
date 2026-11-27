import { authNotice, loginInput, loginScreen, type LoginStep } from "./sign-in-screen.ts";
import { cliOf, pressKeys } from "../core/screens.js";
import type { Hub } from "./hub.ts";
import type { CoreTerminal } from "./hc/protocol.ts";
import { spawn } from "./spawn.ts";
import { keyBytes } from "./terminal.ts";

type Run = (args: string[]) => Promise<{ code: number; stdout: string }>;
type LogItem = { id: string; kind: string; text?: string };
type Card = { id: string; addr: string; opened: number; step: LoginStep };
type Flow = { card: Card; target: string; pid?: number | null; busy?: boolean; pending?: number; previous?: LoginStep; signedTurn?: number };
const stepKey = ({ cursor: _cursor, instructions: _instructions, ...step }: LoginStep) => JSON.stringify(step);
const expiry = 16 * 60 * 1000;
const waiting = (step: LoginStep): LoginStep => ({ cli: step.cli, connector: step.connector, stage: "waiting" });
const gone = "That sign-in step has changed. Use the latest card.";

export class SignInWatch {
  private flows = new Map<string, Flow>();
  private observed = new Map<string, string>();
  private handled = new Map<string, string>();

  constructor(private hub: Hub, private hc: Run, private changed: () => void,
    private log: (addr: string) => LogItem[] = () => [],
    private storeKey?: (machine: string, key: string) => Promise<void>) {}

  address(id: string) {
    return [...this.flows].find(([, f]) => f.card.id === id)?.[0];
  }
  card(addr: string) { return this.flows.get(addr)?.card; }
  needs() { return [...this.flows.values()].map((f) => f.card).filter((c) => c.step.stage !== "signed" && c.step.stage !== "waiting"); }
  helper(addr: string) { return [...this.flows.values()].some((f) => f.target === addr && f.card.addr !== addr); }

  private show(addr: string, step: LoginStep, pid?: number | null) {
    const flow = this.flows.get(addr);
    if (flow && stepKey(flow.card.step) === stepKey(step) && flow.card.step.instructions === step.instructions) return;
    const card = { id: `login-${crypto.randomUUID()}`, addr, opened: flow?.card.opened ?? Date.now(), step };
    if (flow) {
      flow.card = card;
      if (step.stage === "signed") flow.signedTurn = this.hub.terminals.get(addr)?.turn ?? 0;
    }
    else this.flows.set(addr, { card, target: addr, pid });
    this.changed();
  }

  private drop(addr: string) {
    this.observed.delete(addr);
    if (this.flows.delete(addr)) this.changed();
  }

  private async read(addr: string, cols: number, cli: "claude" | "codex", active?: LoginStep, helper = false) {
    const result = await this.hub.call<{ text: string }>("terminal.read", { terminal: addr, lines: 0 }, 5000).catch(() => null);
    if (!result || typeof result.text !== "string") return undefined;
    return loginScreen(cli, result.text, cols, active, helper);
  }

  private lastNotice(addr: string, cli: "claude" | "codex") {
    // Only CLI errors and informational records. Arbitrary chat messages may mention /login.
    const last = this.log(addr).findLast((item) => ["error", "heads", "agent", "user"].includes(item.kind));
    if (!last?.text || !["error", "heads"].includes(last.kind)) return null;
    const step = authNotice(cli, last.text);
    return step ? { id: last.id, step } : null;
  }

  async tick(addr: string, terminal: CoreTerminal | undefined) {
    const flow = this.flows.get(addr);
    if (!terminal || terminal.state !== "live" || (flow?.pid != null && terminal.pid !== flow.pid)) {
      if (flow && flow.target !== addr) await this.hc(["kill", flow.target]).catch(() => undefined);
      this.drop(addr);
      this.handled.delete(addr);
      return false;
    }
    if (flow?.busy) return true;
    const cli = this.cli(terminal);
    if (!cli) { this.drop(addr); return false; }
    const cur = flow?.card.step;
    if (cur?.stage === "key" || cur?.stage === "fallback") return true;
    if (cur?.stage === "signed" && (terminal.turn ?? 0) === flow?.signedTurn) return false;
    const target = flow?.target ?? addr;
    const helper = target !== addr;
    if (helper) {
      const child = this.hub.terminals.get(target);
      if (child?.state === "finished") {
        flow!.target = addr;
        flow!.pending = undefined;
        if (child.exit_code === 0) {
          this.show(addr, { cli: "Codex", connector: cur?.connector, stage: "signed", restart: true });
        } else {
          this.failed(addr, flow!, "Sign-in ended. Try again, or open Codex’s terminal to see which methods your version supports.");
        }
        return true;
      }
      if (flow!.pending && Date.now() - flow!.pending > expiry) {
        const end = await this.hc(["kill", target]).catch(() => null);
        if (end?.code === 0) {
          flow!.target = addr;
          this.failed(addr, flow!, "This sign-in expired. Start again for a fresh link.");
        }
        return true;
      }
    }
    const step = await this.read(target, this.hub.terminals.get(target)?.cols ?? 80, cli, cur, helper);
    if (step === undefined) return !!flow;
    const notice = this.lastNotice(addr, cli);
    const canRetry = cur?.instructions && notice && stepKey(cur) === stepKey(notice.step);
    const next = step ?? (!helper && notice && (canRetry || notice.id !== this.handled.get(addr)) ? notice.step : null);
    if (next) {
      const same = stepKey(next);
      const before = this.observed.get(addr);
      this.observed.set(addr, same);
      if (same === before) {
        if (cur?.instructions && stepKey(cur) === same && !next.instructions) return true;
        if (cur?.stage !== "waiting" || !flow?.previous || stepKey(flow.previous) !== same ||
            !flow.pending || Date.now() - flow.pending > 12_000) {
          this.show(addr, next, terminal.pid);
        }
      }
      return true;
    }
    this.observed.delete(addr);
    if (helper || !flow || cur?.stage === "signed") return helper;
    if (cur?.stage === "continue" || flow.previous?.stage === "continue") {
      this.show(addr, { cli: cur!.cli, stage: "signed", connector: cur?.connector });
      return true;
    }
    if (flow.pending && Date.now() - flow.pending < 30_000) return true;
    this.drop(addr);
    return false;
  }

  private cli(t: CoreTerminal): "claude" | "codex" | null {
    return cliOf(t) ?? (t.labels?.["herdr.agent"] === "claude" || t.labels?.["herdr.agent"] === "codex" ? t.labels["herdr.agent"] : null);
  }

  private failed(addr: string, flow: Flow, instructions: string) {
    flow.pending = undefined;
    const prev = flow.previous;
    if (prev?.options?.length) this.show(addr, { ...prev, instructions });
    else if (flow.card.step.connector) this.show(addr, { ...authNotice("codex", `MCP: Run codex mcp login ${flow.card.step.connector}`)!, instructions });
    else this.show(addr, { cli: flow.card.step.cli, stage: "fallback", instructions });
  }

  private async get(addr: string) {
    return this.hub.call<CoreTerminal & { foreground?: { argv?: string[]; cwd?: string; pid?: number } }>("terminal.get", { terminal: addr }, 5000).catch(() => { throw new Error(gone); });
  }

  private async type(addr: string, terminal: Awaited<ReturnType<SignInWatch["get"]>>, text: string, stillWaiting: () => Promise<boolean>) {
    const core = await this.hub.core();
    const stream = await core.attach(addr, { data() {}, close() {} }, terminal.cols, terminal.rows);
    try {
      const latest = await this.get(addr);
      if (latest.state !== "live" || latest.pid !== terminal.pid || latest.foreground?.pid !== terminal.foreground?.pid) throw new Error(gone);
      if (!await stillWaiting()) throw new Error(gone);
      stream.input(new TextEncoder().encode(text));
    } finally { stream.close(); }
  }

  private async codexTarget(addr: string, terminal: CoreTerminal) {
    const t = await this.get(addr);
    const argv = t.foreground?.argv ?? [];
    const machine = addr.includes("/") ? addr.split("/")[0] : "";
    // Use the CLI on this machine, in the same checkout. A launch with an explicit alternate auth configuration
    // must use its own prompt rather than risk signing into a different account store.
    const cfg = /(?:^|[\s"'])(?:CODEX_HOME|HOME|OPENAI_BASE_URL|CODEX_CA_CERTIFICATE|openai_base_url|mcp_oauth|mcp_servers|cli_auth_credentials_store|forced_login_method|forced_chatgpt_workspace_id)\b|^(?:--profile|-p)(?:=|$)/;
    if ([...(t.argv ?? []), ...argv].some((a) => cfg.test(a)) || this.cli(terminal) !== "codex")
      throw new Error("This Codex uses a custom sign-in setup. Open its terminal to use that setup.");
    const program = argv[0] && /(?:^|\/)codex$/.test(argv[0]) ? argv[0] : "codex";
    return { program, cwd: t.foreground?.cwd ?? t.cwd, machine };
  }

  async act(addr: string, id: string, body: { choice?: unknown; input?: unknown; key?: unknown; back?: unknown; sameComputer?: unknown; cancel?: unknown }) {
    const flow = this.flows.get(addr);
    const original = this.hub.terminals.get(addr);
    if (!flow || flow.card.id !== id || !original || original.state !== "live" || original.pid !== flow.pid || flow.busy || !this.cli(original)) throw new Error(gone);
    flow.busy = true;
    const step = flow.card.step;
    const cli = this.cli(original)!;
    try {
      const target = flow.target;
      const terminal = await this.get(target);
      const helper = target !== addr;
      if (terminal.state !== "live" || (!helper && terminal.pid !== flow.pid) || (!helper && await this.hub.front(target) !== "agent")) throw new Error(gone);
      const live = await this.read(target, terminal.cols, cli, step, helper);
      const notice = this.lastNotice(addr, cli);
      const current = live ?? notice?.step;
      if (step.stage === "key") {
        if (body.back === true && flow.previous) { this.show(addr, flow.previous); return; }
        if (!current || live === undefined || !flow.previous || stepKey(current) !== stepKey(flow.previous)) throw new Error(gone);
        if (typeof body.key !== "string" || !/^[!-~]{8,1024}$/.test(body.key) || !this.storeKey) throw new Error("Paste your OpenAI API key.");
        const { program, cwd, machine } = await this.codexTarget(addr, original);
        await this.storeKey(machine, body.key);
        const child = spawn([process.env.SHEPHERDR_HC || "hc", "exec", ...(machine ? ["--on", machine] : []),
          ...(cwd ? ["--cwd", cwd] : []), "--timeout", "25", "--stdin", "--", program, "login", "--with-api-key"],
        { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
        child.stdin.write(body.key + "\n");
        child.stdin.end();
        if (await child.exited) throw new Error("The key is saved in Secrets. Codex couldn’t use it. Check the key or open its terminal.");
        this.show(addr, { cli: step.cli, stage: "signed", restart: true, apiKeySaved: true });
        return;
      }
      if (!current || live === undefined || stepKey(current) !== stepKey(step)) throw new Error(gone);
      const stillWaiting = async () => {
        const latest = await this.read(target, terminal.cols, cli, step, helper);
        const fresh = latest ?? (latest === null ? this.lastNotice(addr, cli)?.step : undefined);
        return !!fresh && stepKey(fresh) === stepKey(current) && fresh.cursor === current.cursor;
      };
      if (body.cancel === true && step.stage === "browser") {
        if (helper) {
          if ((await this.hc(["kill", target])).code !== 0) throw new Error("Couldn’t cancel sign-in.");
          flow.target = addr;
          this.failed(addr, flow, "Sign-in canceled.");
          return;
        }
        await this.type(target, terminal, "\x1b", stillWaiting);
      } else if (step.input) {
        const input = loginInput(step, body.input);
        if (!input) throw new Error(step.input === "callback" ? "Paste the full address from the browser for this sign-in." : "Paste the code Claude gave you.");
        await this.type(target, terminal, input + "\r", stillWaiting);
      } else {
        const index = body.choice;
        const choice = typeof index === "number" && Number.isInteger(index) ? current.options?.[index] : undefined;
        if (!choice || (choice.fallback && !(choice.sameComputer && body.sameComputer === true))) throw new Error(gone);
        if (choice.mode === "key") {
          flow.previous = step;
          this.show(addr, { cli: step.cli, stage: "key" });
          return;
        }
        if (choice.mode) {
          const { program, cwd, machine } = await this.codexTarget(addr, original);
          const args = choice.mode === "connector" ? ["mcp", "login", current.connector!, "--no-browser"]
            : choice.mode === "device" ? ["login", "--device-auth"] : ["login"];
          const r = await this.hc(["run", "--bg", "--json", "--no-parent", "--no-notify",
            ...(machine ? ["--on", machine] : []), ...(cwd ? ["--cwd", cwd] : []), "--", program, ...args]);
          const child = r.code === 0 ? JSON.parse(r.stdout)?.address : null;
          if (typeof child !== "string" || !/^(?:[\w.-]+\/)?t[0-9a-z]+$/.test(child)) throw new Error("Couldn't start sign-in on that machine.");
          flow.target = child;
        } else if (choice.command) {
          await this.type(target, terminal, choice.command + "\r", async () => {
            if (!await stillWaiting()) return false;
            const screen = await this.hub.call<{ text: string }>("terminal.read", { terminal: target, lines: 0 }, 5000);
            const prompt = screen.text.split("\n").findLast((l) => /^\s*❯(?:\s|$)/.test(l));
            if (prompt?.trim() !== "❯") throw new Error("Clear the draft in Claude’s terminal before starting sign-in.");
            return true;
          });
        } else if (choice.keys !== undefined) {
          const keys = current.closeMenu ? ["esc", "esc"] : pressKeys(current.cursor ?? 0, choice.keys);
          await this.type(target, terminal, keyBytes(keys)!, stillWaiting);
        }
      }
      if (notice) this.handled.set(addr, notice.id);
      flow.previous = step;
      flow.pending = Date.now();
      this.show(addr, waiting(step));
    } finally { flow.busy = false; }
  }
}
