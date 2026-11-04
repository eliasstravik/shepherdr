// The few node-style modules a mod may import, as far as the page needs them.
export const join = (...p) => p.join("/").replace(/\/+/g, "/");
export const resolve = join;
export const dirname = (p) => p.replace(/\/[^/]*\/?$/, "") || "/";
export const basename = (p, ext) => { const b = p.replace(/\/+$/, "").split("/").pop(); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; };
export const extname = (p) => /\.[^./]*$/.exec(p)?.[0] ?? "";
export const randomUUID = () => crypto.randomUUID();
export const platform = () => "linux";
export const arch = () => "arm64";
export const nextTick = (f, ...a) => queueMicrotask(() => f(...a));
export const env = {};
export default { join, resolve, dirname, basename, extname, randomUUID, platform, arch, nextTick, env };
