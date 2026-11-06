/** The service worker, beside the page under whatever path the app is served on (/shepherdr/), its scope that folder.
 *  Same-origin, so its fetch carries the login cookie of a gate in front (GitHub #494). */
export function registerWorker() {
  const base = new URL('./', document.baseURI)
  return navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.pathname })
}
