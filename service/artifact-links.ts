// The link catcher every artifact page runs first (served by artifacts.ts, and by the demo), on its own: no imports.

/** What every artifact page runs first (a YouTube link took over the frame and left a dead grey panel): a
 *  tap on a link to another site, or to the app itself, never moves the frame; it asks the app, which opens another
 *  site in a new tab (unsandboxed, so the site works) and its own links (an artifact, a task, a space) in place. Links
 *  inside the artifact (its anchors, its other pages and files) go on as they were. It also tells the app that a page
 *  of the artifact is showing ("page"), as it starts and again on its load, so a frame that ends on a page it can't
 *  show (no word near its load) gets a calm notice instead. Caught on the document as it starts, so links the page's own script makes
 *  are caught too.
 *  A form sent to the artifact itself (a Reply box whose script posts the answer but lets the form go on) never moves
 *  the frame either: the page is read only, so that would only lose it (the service answers "read only").
 *  Mark up (the app says {shepherdr:"markup",on}): a tap on the page drops a pin there, drawn in the page, and says
 *  where ("spot": x and y as fractions of the whole page) instead of doing what it would; the page still scrolls
 *  (wheel, touch, keys), as nothing covers it. */
export const LINKS_JS = `(function(){if(window.parent===window)return;var S=function(m){try{parent.postMessage(m,"*")}catch(x){}};`
  + `var root=location.pathname.replace(/\\/page\\/.*$/,"/page/");S({shepherdr:"page"});`
  + `var inside=function(u){return u.origin===location.origin&&u.pathname.indexOf(root)===0};`
  + `addEventListener("load",function(){S({shepherdr:"page"})});`
  + `var mk=false,pin=null,css=null;`
  + `addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.shepherdr!=="markup")return;mk=!!d.on;var de=document.documentElement;`
  + `if(mk&&!css){css=document.createElement("style");css.textContent="html,html *{cursor:crosshair!important}";de.appendChild(css)}`
  + `if(!mk){if(css)css.remove();if(pin)pin.remove();css=pin=null}});`
  + `addEventListener("click",function(e){if(!mk)return;e.preventDefault();e.stopImmediatePropagation();var de=document.documentElement;`
  + `if(!pin){pin=document.createElement("div");pin.setAttribute("aria-hidden","true");`
  + `pin.style.cssText="position:absolute;z-index:2147483647;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:#0a0a0a;box-shadow:0 0 0 2px #fff;pointer-events:none";de.appendChild(pin)}`
  + `pin.style.left=e.pageX+"px";pin.style.top=e.pageY+"px";`
  + `S({shepherdr:"spot",x:e.pageX/Math.max(1,de.scrollWidth),y:e.pageY/Math.max(1,de.scrollHeight)})},true);`
  + `addEventListener("submit",function(e){var f=e.target,u;if(e.defaultPrevented||!f||!f.getAttribute)return;`
  + `try{u=new URL(f.getAttribute("action")||"",document.baseURI)}catch(x){return}var t=f.getAttribute("target");`
  + `if(inside(u)&&(!t||t==="_self"))e.preventDefault()});`
  + `document.addEventListener("click",function(e){if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;`
  + `var t=e.target,a=t&&t.closest?t.closest("a[href]"):null;if(!a||a.hasAttribute("download"))return;`
  + `var h=a.getAttribute("href");if(!h||h.charAt(0)==="#")return;var u;try{u=new URL(h,document.baseURI)}catch(x){return}`
  + `if(u.protocol!=="http:"&&u.protocol!=="https:")return;`
  + `if(inside(u)){if(!a.target||a.target==="_self")S({shepherdr:"inside"});return}`
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
