// A menu that opens over the Settings page (the level switch's spaces, Secrets' For and Kept on) is drawn last, after
// everything under it: drawn inside its own row, the rows after it on the page drew over it and showed through it
// (GitHub #1002). `first` (the row the menu opens from) sits at the top of a relative column holding the rest, so the
// menu's place is measured from that row as before.
import { v_flex } from "gpui-base";

export function over(first, rest, menu) {
  return v_flex().relative().w_full().child(first).children(rest).when(Boolean(menu), (el) => el.child(menu));
}
