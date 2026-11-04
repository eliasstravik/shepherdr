// The `herdr` module, one instance per mod copy (its URL carries ?copy=): what a mod may ask of
// Herdr, answered from the server's live state. Reads are live; the person's actions go to the
// server, which lets through only those (web/safety.ts). Things the window does by itself
// (notifications, sounds, layout changes on other screens) do nothing here.
import { state, call, copies, localShared, touch } from "./core.js";
import * as model from "./model.js";
import { hooks } from "./hooks.js";

const COPY = new URL(import.meta.url).searchParams.get("copy");
const me = () => copies.get(COPY);

export const exec = (command, args = [], options = {}) => call("exec", command, args, options);
export const hc = (args) => call("hc", args);
export const home = () => state.home;
export const appHome = () => state.appHome;
export const readTextFile = (path, options = {}) => call("readTextFile", path, options);
export const writeTextFile = (path, text, expected) => call("writeTextFile", path, text, expected);
export const knownAgents = async () => [];
export const pickFolder = async () => null;
export const playSound = () => null;
export const run = (name, args = {}) => { hooks.run(name, args, COPY); return null; };

export const machines = model.machines;
export const spaces = model.spaces;
export const agents = model.agents;
export const panes = model.panes;
export const terminals = model.terminals;
export const focused = model.focused;
export const theme = model.theme;
export const themes = model.themes;
export const settings = model.settings;
export const keys = model.keys;
export const setAgentOrder = () => null;
export const layout = () => hooks.layout();
export const layouts = () => [state.layoutName ?? "shepherdr"];
export const commands = () => [];
export const window = () => ({ platform: "linux", titlebar: "none", buttons: false, maximized: true, fullscreen: false, active: document.hasFocus() });
export const placement = () => null;
export const fonts = () => ["Geist", "JetBrains Mono"];
export const updates = () => ({ app: { version: "web", ready: null, updates: false }, notes: [], core: { version: null, managed: null, ready: null, updating: false, error: null }, checked: null, checks: false, checking: false });
export const presentUpdateNotes = () => null;
export const telemetry = () => null;
export const feedbackPreview = () => ({ body: null, available: false });
export const sendFeedback = async () => null;

export const openOverlay = (spec) => hooks.openOverlay(spec, COPY);
export const closeOverlay = (id) => { hooks.closeOverlay(id); return null; };
// The window posts notifications; the page doesn't post them twice.
export const notify = () => `web-${Math.random().toString(36).slice(2)}`;

export const props = () => me()?.props ?? {};

export function shared(key) {
  if (localShared.has(key)) return localShared.get(key);
  return state.shared?.[key] ?? null;
}
export function setShared(key, value) {
  localShared.set(key, value);
  touch("shared");
  return null;
}

// Key commands for this copy ("<mod>.<command>" from run, or the page's own keys).
export function nextCommand() {
  const c = me();
  if (!c) return new Promise(() => {});
  if (c.commands.length) return Promise.resolve(c.commands.shift());
  return new Promise((resolve) => c.commandWaiters.push(resolve));
}

export const watchFolder = (path) => call("watch", path);
