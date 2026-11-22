// Mark up's words and its pin in words: tap a page an agent made to drop a pin, write what should change, and Send
// gives it to the agent that keeps it (herdr-artifact note --spot "x,y"). The pin is fractions of the page's width and
// height (0 to 1), so it means the same at any size; herdr-artifact says it to the agent in the same words (spot_of).

export const MARKUP = {
  placeholder: "What should change?",
  clear: "Remove pin",
  sending: "Sending…",
  failed: "That didn't go through. Try again.",
  spot: "A note on the pinned spot.",
};

// The card's line before anything is pinned, and once it went: keeper is the agent's program ("Claude Code"), else
// "the agent".
export const markupHint = (keeper) => `Tap the page to drop a pin, or write to ${keeper} about all of it.`;
export const markupSent = (keeper) => `Sent to ${keeper}. A new version shows here when it's in.`;

const REGION_Y = ["top", "middle", "bottom"], REGION_X = ["left", "center", "right"];
const clamp = (v) => Math.min(1, Math.max(0, Number(v) || 0));

/** The pin as herdr-artifact takes it: "0.420,0.310". */
export const spotArg = (s) => `${clamp(s?.x).toFixed(3)},${clamp(s?.y).toFixed(3)}`;

/** The pin in words: "42% from the left, 31% from the top of the page (near the top center)". */
export function describe(s) {
  const x = clamp(s?.x), y = clamp(s?.y);
  const third = (v) => Math.min(2, Math.floor(v * 3));
  const yx = [REGION_Y[third(y)], REGION_X[third(x)]];
  const near = yx[0] === "middle" && yx[1] === "center" ? "the middle" : yx[0] === "middle" ? `the middle ${yx[1]}` : yx[1] === "center" ? `the ${yx[0]} center` : `the ${yx[0]} ${yx[1]}`;
  return `${Math.round(x * 100)}% from the left, ${Math.round(y * 100)}% from the top of the page (near ${near})`;
}
