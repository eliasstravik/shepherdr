// A wake word on a phone (POST /api/voice/wake, SHEP-240): the Shepherdr page already open on that device starts a
// voice call; a page of another device never does; none on screen yet, the first of that device to show up within 15 s.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Live, WAKE_HELD_MS } from "./live.ts";
import { deviceOf, forwardedFrom } from "./tailscale.ts";

const NOW = 1_800_000_000_000;
const PHONE = "nPhone1CNTRL", MAC = "nMac1CNTRL";
afterEach(() => setSystemTime());

function page(from: string, seen: number, visible = true) {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, data: { who: "x", seen, visible, from }, send: (t: string) => sent.push(JSON.parse(t)), getBufferedAmount: () => 0 } as any };
}
const live = () => new Live({ on() {} } as any, { on() {} } as any, () => null, "0");
const add = (l: Live, ...ps: { ws: any }[]) => { for (const p of ps) (l as any).pages.add(p.ws); };
/** the page says it is on screen (it does at connect and each time it comes back) */
const shows = (l: Live, p: { ws: any }) => l.message(p.ws, JSON.stringify({ type: "watch", chats: [], visible: true }));

test("the device's page on screen starts the call now; the Mac's page, newer, doesn't", () => {
  setSystemTime(NOW);
  const l = live(), phone = page(PHONE, NOW - 5000), mac = page(MAC, NOW), phoneHidden = page(PHONE, NOW + 10, false);
  add(l, phone, mac, phoneHidden);
  expect(l.voiceWake(PHONE)).toBe(true);
  expect(phone.sent).toEqual([{ type: "voice" }]);
  expect(mac.sent).toEqual([]);
  expect(phoneHidden.sent).toEqual([]);
  // taken: a later page of the phone doesn't start a second one
  const later = page(PHONE, NOW);
  add(l, later); shows(l, later);
  expect(later.sent).toEqual([]);
});

test("none on screen yet: held for the device's first page that shows up", () => {
  setSystemTime(NOW);
  const l = live(), phone = page(PHONE, NOW - 60_000, false), mac = page(MAC, NOW);
  add(l, phone, mac);
  expect(l.voiceWake(PHONE)).toBe(false);
  expect(phone.sent).toEqual([]);
  // the Mac's page coming back on screen isn't the phone
  shows(l, mac);
  expect(mac.sent).toEqual([]);
  setSystemTime(NOW + WAKE_HELD_MS - 1000);
  shows(l, phone);
  expect(phone.sent).toEqual([{ type: "voice" }]);
  // once only
  shows(l, phone);
  expect(phone.sent.length).toBe(1);
});

test("a page that comes in hidden doesn't take it; the same one on screen later does", () => {
  setSystemTime(NOW);
  const l = live(), phone = page(PHONE, NOW, false);
  add(l, phone);
  l.voiceWake(PHONE);
  l.message(phone.ws, JSON.stringify({ type: "watch", chats: [], visible: false }));
  expect(phone.sent).toEqual([]);
  shows(l, phone);
  expect(phone.sent).toEqual([{ type: "voice" }]);
});

test("held 15 s at most: a page that shows up later starts nothing", () => {
  setSystemTime(NOW);
  const l = live();
  expect(l.voiceWake(PHONE)).toBe(false);
  setSystemTime(NOW + WAKE_HELD_MS + 1);
  const phone = page(PHONE, NOW + WAKE_HELD_MS + 1);
  add(l, phone); shows(l, phone);
  expect(phone.sent).toEqual([]);
});

test("a device's IPv4 and IPv6 addresses are the same device; no whois answer, the address itself", async () => {
  const node = (id: string) => async () => ({ ok: true, out: JSON.stringify({ Node: { StableID: id } }), err: "" });
  expect(await deviceOf("100.64.0.7", node("nP7"))).toBe("nP7");
  expect(await deviceOf("fd7a:115c:a1e0::7", node("nP7"))).toBe("nP7");
  expect(await deviceOf("100.64.0.9", async () => ({ ok: false, out: "", err: "no" }))).toBe("100.64.0.9");
  // a failure isn't kept: it asks again next time
  expect(await deviceOf("100.64.0.9", node("nP9"))).toBe("nP9");
});

test("the forwarded address: tailscale serve's, first entry; none without it", () => {
  const r = (h: Record<string, string>) => new Request("http://127.0.0.1/", { headers: h });
  expect(forwardedFrom(r({ "x-forwarded-for": "100.64.0.7" }))).toBe("100.64.0.7");
  expect(forwardedFrom(r({ "x-forwarded-for": "100.64.0.7, 10.0.0.1" }))).toBe("100.64.0.7");
  expect(forwardedFrom(r({}))).toBeNull();
});
