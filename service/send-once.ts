// A page's send, once (SHEP-93): a phone that lost the answer asks again with the same id.

/** What pages sent lately, by the page's id (cid): a send asked again while on its way waits for it and gets its
 *  answer, one that went in answers again without going twice; one that failed may go again. Kept an hour. */
const sends = new Map<string, { at: number; going: Promise<unknown> }>();
export function once(cid: string, go: () => Promise<unknown>): Promise<unknown> {
  for (const [k, v] of sends) if (Date.now() - v.at > 60 * 60_000) sends.delete(k);
  const was = sends.get(cid);
  if (was) return was.going;
  const e = { at: Date.now(), going: go() };
  sends.set(cid, e);
  e.going.catch(() => { if (sends.get(cid) === e) sends.delete(cid); });
  return e.going;
}
