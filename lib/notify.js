// Notify in the window: the rules are core/notify.js (shared with the service and the web app); the setting
// is shared "notify" here. A space row's menu sets the space's (mods/spaces-chat), Shepherdr settings' Notify
// any of them (mods/shepherdr-settings). Picking what it would get anyway goes back to following.
// Shared: the source is lib/notify.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/notify.js, never a mod's copy, then run bin/sync-shared.

import { shared, setShared } from "herdr";
import { everywhereOf, machineLevel, machineOwn, spaceLevel, spaceOwn, withSpace, withMachine, withEverywhere, notifiesBy } from "./core/notify.js";

export { NOTIFY, NOTIFY_DEFAULT, NOTIFY_HINT, spaceOfTerminal } from "./core/notify.js";

const stored = () => shared("notify") ?? {};

export const notifyEverywhere = () => everywhereOf(stored());
export const notifyMachine = (m) => machineLevel(stored(), m);
export const notifyMachineOwn = (m) => machineOwn(stored(), m);
export const notifyOf = (space) => spaceLevel(stored(), space);
export const notifyOwn = (space) => spaceOwn(stored(), space);
export const muted = (space) => notifyOf(space) === "Off";

export const setNotify = (space, value) => setShared("notify", withSpace(stored(), space, value));
export const setNotifyMachine = (m, value) => setShared("notify", withMachine(stored(), m, value));
export const setNotifyEverywhere = (value) => setShared("notify", withEverywhere(stored(), value));

export const notifies = (k, kind) => notifiesBy(stored(), k, kind);
