// The link catcher every artifact page runs first (served by artifacts.ts, and by the demo), on its own: no imports.

/** What every artifact page runs first (a YouTube link took over the frame and left a dead grey panel): a
 *  tap on a link to another site, or to the app itself, never moves the frame; it asks the app, which opens another
 *  site in a new tab (unsandboxed, so the site works) and its own links (an artifact, a task, a space) in place. Links
 *  inside the artifact (its anchors, its other pages and files) go on as they were. It also tells the app that a page
 *  of the artifact is showing ("page"), as it starts and again on its load, so a frame that ends on a page it can't
 *  show (no word near its load) gets a calm notice instead. Caught on the document as it starts, so links the page's own script makes
 *  are caught too. */
export const LINKS_JS = `(function(){if(window.parent===window)return;var S=function(m){try{parent.postMessage(m,"*")}catch(x){}};`
  + `var root=location.pathname.replace(/\\/page\\/.*$/,"/page/");S({shepherdr:"page"});`
  + `addEventListener("load",function(){S({shepherdr:"page"})});`
  + `document.addEventListener("click",function(e){if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;`
  + `var t=e.target,a=t&&t.closest?t.closest("a[href]"):null;if(!a||a.hasAttribute("download"))return;`
  + `var h=a.getAttribute("href");if(!h||h.charAt(0)==="#")return;var u;try{u=new URL(h,document.baseURI)}catch(x){return}`
  + `if(u.protocol!=="http:"&&u.protocol!=="https:")return;`
  + `if(u.origin===location.origin&&u.pathname.indexOf(root)===0){if(!a.target||a.target==="_self")S({shepherdr:"inside"});return}`
  + `e.preventDefault();S({shepherdr:"link",href:u.href})},true)})();`;

/** An artifact's HTML with LINKS_JS first: in its head, else after <html>, else after the doctype (never before it,
 *  which would put the page in quirks mode), else at the very start. */
export function withLinks(html: string): string {
  const tag = `<script>${LINKS_JS}</script>`;
  const at = /<head(?:\s[^>]*)?>/i.exec(html) ?? /<html(?:\s[^>]*)?>/i.exec(html) ?? /^\s*<!doctype[^>]*>/i.exec(html);
  if (!at) return tag + html;
  const end = at.index + at[0].length;
  return html.slice(0, end) + tag + html.slice(end);
}
