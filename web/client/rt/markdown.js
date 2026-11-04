// TextView.markdown in the page: Markdown to HTML, raw HTML shown as text, then sanitized
// (agents' words are not trusted). Links open in a new tab.
import { Marked } from "../vendor/marked.js";
import DOMPurify from "../vendor/purify.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const md = new Marked({ gfm: true, breaks: false });
md.use({ renderer: { html: ({ text }) => esc(text) } });
DOMPurify.addHook("afterSanitizeAttributes", (n) => { if (n.tagName === "A") { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener noreferrer"); } });

const cache = new Map();
export function renderMarkdown(text) {
  const t = String(text ?? "");
  let h = cache.get(t);
  if (h === undefined) {
    h = DOMPurify.sanitize(md.parse(t), { USE_PROFILES: { html: true } });
    if (cache.size > 2000) cache.clear();
    cache.set(t, h);
  }
  return h;
}
