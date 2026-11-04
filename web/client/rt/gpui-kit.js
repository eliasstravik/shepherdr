// "gpui-kit" for mods in the page: views, elements, and the stubs nothing in this PoC draws.
export { div, svg, image } from "./el.js";
import { El } from "./el.js";

export class View {
  constructor(props) { this.__props = props; }
  render() { return new El("div"); }
}

// Paths and gradients (only the Win98 layout uses them): drawn as nothing for now.
const chain = () => new Proxy({}, { get: (_t, k) => (k === "build" ? () => ({}) : () => chain()) });
export const PathBuilder = { fill: chain, stroke: chain };
export const Background = {
  linear_gradient: (angle, from, to) => ({ css: `linear-gradient(${angle}deg, ${from}, ${to})`, opacity() { return this; } }),
  checkerboard: (c) => ({ css: c, opacity() { return this; } }),
  solid: (c) => ({ css: c, opacity() { return this; } }),
};
export const list = () => new El("div");
export const uniform_list = () => new El("div");
