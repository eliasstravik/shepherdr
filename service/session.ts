// Shepherdr's own herdr-core session. On every machine Shepherdr runs its chats, tasks and its own terminals in a
// named herdr-core session of its own, not in the default one the Herdr app shows: agents started in Shepherdr never
// appear in the Herdr app, and terminals opened there never appear in Shepherdr. herdr-task uses the same name.
// SHEPHERDR_SESSION names another (tests: a throwaway one; empty: herdr-core's default session).
export const SESSION: string = process.env.SHEPHERDR_SESSION ?? "shepherdr";

/** process.env names the session too (node's child_process reads it). Bun.spawn doesn't pass a change made here to
 *  its children (SHEP-294): every program the service starts goes through spawn.ts, which gives each the session. */
export function useSession() {
  if (SESSION) process.env.HC_SESSION = SESSION;
  else delete process.env.HC_SESSION;
}
