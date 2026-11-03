// A day's line between messages, as Shepherdr has it (plugins/chat/days.ts): Today, Yesterday,
// a weekday this week, else its date (and year, if not this one).

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// The calendar day a time falls on, to tell where a new one starts.
export const dayOf = (at) => start(new Date(at));

export function dayLabel(at, now = new Date()) {
  const d = new Date(at);
  const days = Math.round((start(now) - start(d)) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return DAYS[d.getDay()];
  return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}
