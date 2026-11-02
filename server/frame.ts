// Wraps an artifact's page for a sealed frame: Shepherdr's colours for light and dark, a size reporter, its data, the
// Send bridge (a form's Send becomes one line typed into its keeper's terminal) and Mark up. The response carries a
// sandbox CSP, so the page never runs with Shepherdr's origin, even opened directly, and loads nothing at all.
import { CHECK_PROBE } from './artifact-check.ts'

/** Shepherdr's dark colours: by the device's own mode, or the appearance the app has (the shepherdr-dark or -light
 *  class, which the app sends again when it changes) */
const DARK = '--bg:#0b0b0d;--fg:#fafafa;--fg2:#a1a1aa;--fg3:#71717a;--line:rgb(255 255 255/.07);--line2:rgb(255 255 255/.12);--well:#111114;--bubble:#1c1c20;--need:#ff6369;--ready:#3dd68c;--work:#f5b544;--accent:#fb923c;--chart-1:#fb923c;--chart-2:#60a5fa;--chart-3:#4ade80;--chart-4:#c084fc;--chart-5:#facc15'

const BASE_CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#09090b;--fg2:#52525b;--fg3:#a1a1aa;--line:rgb(9 9 11/.07);--line2:rgb(9 9 11/.12);--well:#fafafa;--bubble:#f4f4f5;--need:#e5484d;--ready:#30a46c;--work:#e2a336;--accent:#c2410c;--focus:#3b82f6;--chart-1:#c2410c;--chart-2:#2563eb;--chart-3:#16a34a;--chart-4:#9333ea;--chart-5:#ca8a04}
@media(prefers-color-scheme:dark){:root:not(.shepherdr-light){__DARK__}}
:root.shepherdr-dark{color-scheme:dark;__DARK__}:root.shepherdr-light{color-scheme:light}
__FONTFACE__
[hidden]{display:none!important}
.phone body{font-size:16px;line-height:24px}
:where(body){display:flow-root;box-sizing:border-box;padding:12px}
:where(.shepherdr-fixed body){padding:0}
:where(img,video,canvas,svg,iframe,embed,object){box-sizing:border-box;max-width:100%;max-height:var(--shepherdr-fit,none)}
:where(img,video,canvas){height:auto;object-fit:contain}:where(svg[viewBox]){height:auto}
html,body{margin:0;background:transparent;color:var(--fg);font:14px/20px InterVariable,ui-sans-serif,system-ui,sans-serif;font-feature-settings:"cv02","cv03","cv04","cv11";-webkit-font-smoothing:antialiased}
.shepherdr-hover{outline:2px dashed var(--focus)!important;outline-offset:3px;cursor:crosshair!important}
.shepherdr-markup :is(button,a,input,select,textarea,[role=button]){outline:2px dashed var(--focus);outline-offset:3px;cursor:crosshair}
`

const BRIDGE = `
(function(){
  var sent = __SENT__, data = __DATA__;
  var markup = false, hovered = null;
  function post(m){ m.shepherdr = m.shepherdr; parent.postMessage(m, '*') }
  var full = document.documentElement.classList.contains('full');
  /* the most the chat lets the frame grow, from the app; growth that only follows the frame's own height */
  var cap = Infinity, grew = 0, lastGap = 0, lastVH = 0, stuck = false, sized = false, painted = false;
  /* a fixed-size design says its size: <meta name="shepherdr-size" content="1200x630"> */
  function declared(){
    var m = document.querySelector('meta[name=shepherdr-size]'), v = m && /^ *([0-9]+) *x *([0-9]+) *$/i.exec(m.getAttribute('content') || '');
    return v && +v[1] > 0 && +v[2] > 0 ? { w: +v[1], h: +v[2] } : null;
  }
  /* A page fills the frame's width, and what is wider than that scrolls sideways. A fixed-size design lays out at its
     size and is scaled to fit whole (in the chat to its width, up to its cap; full screen to the screen, centred),
     keeping its shape, and at most to twice its size. Then the body's own height goes up, so a page that gets shorter
     shrinks its frame too. */
  function size(){
    var de = document.documentElement, b = document.body; if (!b) return;
    var d = declared();
    de.classList.toggle('shepherdr-fixed', !!d);
    /* a fixed-size body is exactly its size, with no margin; what this sets, it sets again each time, and a page's own
       inline styles stay when it isn't one */
    if (d || sized) { b.style.width = d ? d.w + 'px' : ''; b.style.height = d ? d.h + 'px' : ''; b.style.margin = d ? '0' : '' }
    sized = !!d;
    var cs = getComputedStyle(b), mt = parseFloat(cs.marginTop) || 0, mb = parseFloat(cs.marginBottom) || 0;
    /* media fits what shows of the frame: full screen (or opened on its own) the screen, in the chat its cap, less the
       body's padding; a fixed-size design keeps its own sizes */
    var view = full || parent === window ? innerHeight : cap;
    var fit = !d && view < Infinity ? Math.max(48, view - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - mt - mb) + 'px' : '';
    if (de.style.getPropertyValue('--shepherdr-fit') !== fit) de.style.setProperty('--shepherdr-fit', fit);
    var W = de.clientWidth, H = de.clientHeight, bh = b.offsetHeight;
    var s = 1, x = 0, y = 0;
    if (d) {
      s = Math.min(W / b.offsetWidth, (full ? H : cap) / bh, 2);
      x = Math.max(0, (W - b.offsetWidth * s) / 2);
      if (full) y = Math.max(0, (H - bh * s) / 2);
    }
    var t = s === 1 && !x && !y ? '' : 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
    if (b.style.transform !== t) { b.style.transformOrigin = '0 0'; b.style.transform = t }
    /* the page's own background stays on the page, not in the bands around it (unless the page gives them one) */
    if (t && !painted) {
      var hs = getComputedStyle(de);
      if (hs.backgroundColor === 'rgba(0, 0, 0, 0)' && hs.backgroundImage === 'none') { de.style.background = 'var(--bg)'; painted = true }
    } else if (!t && painted) { de.style.background = ''; painted = false }
    /* a scaled body still takes its whole height in the layout: take back what it no longer uses, so nothing scrolls */
    if (s !== 1) b.style.marginBottom = -bh * (1 - s) + 'px';
    /* what overflows a body held to the frame's height (height:100%) counts too, and a sideways scrollbar */
    var over = b.scrollHeight > b.clientHeight + 1 ? b.scrollHeight + (parseFloat(cs.paddingBottom) || 0) + b.offsetHeight - b.clientHeight : 0;
    var h = Math.ceil((d ? bh * s : Math.max(bh, over)) + mt + mb + (innerHeight - de.clientHeight)), vh = innerHeight, gap = h - vh;
    /* a page as tall as its frame (100vh and a margin) outgrows it by the same each time the frame grows: it stays */
    if (vh !== lastVH) grew = vh > lastVH && gap > 0 && gap === lastGap ? grew + 1 : 0;
    else if (gap !== lastGap) grew = 0;
    lastGap = gap; lastVH = vh;
    stuck = grew >= 2;
    post({ shepherdr: 'height', h: stuck ? vh : h, stuck: stuck, grows: grew > 0 });
    more();
  }
  /* more of the page below what shows (not the bit a page as tall as its frame outgrows it by): the card says so */
  function more(){
    var de = document.documentElement;
    post({ shepherdr: 'more', more: !stuck && de.scrollHeight - de.scrollTop - de.clientHeight > 2 });
  }
  addEventListener('scroll', more, { passive: true });
  window.shepherdr = {
    sent: sent,
    data: data,
    full: full,
    send: function(text){ post({ shepherdr: 'send', text: String(text) }) },
  };
  document.addEventListener('submit', function(e){
    e.preventDefault();
    var f = e.target, parts = [];
    new FormData(f).forEach(function(v, k){ parts.push(k + ': ' + v) });
    window.shepherdr.send(parts.join(', '));
  }, true);
  function selector(el){
    var parts = [];
    while (el && el.nodeType === 1 && parts.length < 4) {
      var s = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(s + '#' + el.id); break }
      var cls = Array.prototype.slice.call(el.classList).filter(function(c){ return c.indexOf('shepherdr') !== 0 && c !== 'full' && c !== 'phone' }).slice(0, 2);
      if (el.tagName === 'HTML' || el.tagName === 'BODY') cls = [];
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
  function component(el){
    while (el && el.nodeType === 1) { if (el.dataset && el.dataset.component) return el.dataset.component; el = el.parentElement }
    return undefined;
  }
  document.addEventListener('mouseover', function(e){
    if (!markup) return;
    if (hovered) hovered.classList.remove('shepherdr-hover');
    hovered = e.target; hovered.classList.add('shepherdr-hover');
  });
  document.addEventListener('click', function(e){
    if (!markup) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target, r = el.getBoundingClientRect();
    post({ shepherdr: 'pick', text: (el.innerText || el.value || '').trim().slice(0, 80), selector: selector(el), component: component(el), x: r.right, y: r.top });
  }, true);
  /* a link never takes the frame anywhere: a web link opens in a new tab of its own, an anchor in the page scrolls */
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented) return;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#') return;
    e.preventDefault();
    if (/^https?:/i.test(a.href)) post({ shepherdr: 'open', url: a.href });
  });
  addEventListener('message', function(e){
    var d = e.data || {};
    if (d.shepherdr === 'markup') { markup = !!d.on; document.documentElement.classList.toggle('shepherdr-markup', markup); if (!markup && hovered) { hovered.classList.remove('shepherdr-hover'); hovered = null } }
    if (d.shepherdr === 'theme') { var de = document.documentElement; de.classList.toggle('shepherdr-dark', d.theme === 'dark'); de.classList.toggle('shepherdr-light', d.theme === 'light') }
    if (d.shepherdr === 'sent') { window.shepherdr.sent = d.text; document.dispatchEvent(new CustomEvent('shepherdr:sent', { detail: d })) }
    if (d.shepherdr === 'cap' && d.h > 0) { cap = d.h; size() }
    if (d.shepherdr === 'data') { window.shepherdr.data = d.data; document.dispatchEvent(new CustomEvent('shepherdr:data', { detail: d.data })) }
  });
  addEventListener('load', size);
  addEventListener('resize', size);
  if (window.ResizeObserver) addEventListener('DOMContentLoaded', function(){ new ResizeObserver(size).observe(document.body) });
})();
`

/** the frame's whole policy: its own inline code and styles, pictures as data, and nothing from anywhere else */
export const SEALED = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data: 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'`

/** JSON inside a script tag: no "</script>" can end it early */
const inScript = (v: unknown) => JSON.stringify(v ?? null).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export function wrapPage(html: string, opts: { sent?: string; data?: unknown; big?: boolean; font?: string; phone?: boolean; check?: boolean; theme?: 'light' | 'dark' } = {}) {
  // the check opens the file on its own: the same policy as a meta, and a probe that keeps what breaks, before all else
  const check = opts.check ? `<meta http-equiv="Content-Security-Policy" content="${SEALED}">${CHECK_PROBE}` : ''
  const font = opts.check ? '' : `@font-face{font-family:InterVariable;font-style:normal;font-weight:100 900;font-display:swap;src:url("${opts.font ?? '../font/InterVariable.woff2'}") format("woff2")}`
  // on one line, so a script error's line number is the page's own
  const head = `<meta charset="utf-8">${check}<meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_CSS.replace(/\n/g, '').replace(/__DARK__/g, DARK).replace('__FONTFACE__', () => font)}</style><script>${BRIDGE.replace(/\n\s*/g, ' ').replace('__SENT__', () => inScript(opts.sent)).replace('__DATA__', () => inScript(opts.data))}</script>`
  const classes = [opts.big && 'full', opts.phone && 'phone', opts.theme && `shepherdr-${opts.theme}`].filter(Boolean).join(' ')
  const cls = classes ? ` class="${classes}"` : ''
  // the page's own <html> keeps its classes and gains ours; <header> is not <head>, and a page always gets a doctype
  const HTML = /<html(\s[^>]*)?>/i
  const HEAD = /<head(\s[^>]*)?>/i
  const DOCTYPE = /^\s*<!doctype[^>]*>/i
  const tagged = (doc: string) =>
    doc.replace(HTML, (_m, attrs = '') => (!classes ? `<html${attrs}>` : /\bclass\s*=\s*"/i.test(attrs) ? `<html${attrs.replace(/\bclass\s*=\s*"/i, `class="${classes} `)}>` : `<html${attrs}${cls}>`))
  const typed = (doc: string) => (DOCTYPE.test(doc) ? doc : `<!doctype html>${doc}`)
  if (HTML.test(html)) return typed(tagged(HEAD.test(html) ? html.replace(HEAD, (m) => `${m}${head}`) : html.replace(HTML, (m) => `${m}<head>${head}</head>`)))
  const body = html.replace(DOCTYPE, '')
  if (HEAD.test(body)) return `<!doctype html><html${cls}>${body.replace(HEAD, (m) => `${m}${head}`)}</html>`
  return `<!doctype html><html${cls}><head>${head}</head><body>${body}</body></html>`
}

export function frameResponse(html: string) {
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `sandbox allow-scripts allow-forms; ${SEALED}; frame-ancestors 'self'`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  })
}
