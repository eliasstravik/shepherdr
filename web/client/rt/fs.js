// "fs/promises" for a mod in the page: reads go to the server; writes are refused there (the
// window owns the app's files).
import { call } from "./core.js";

export const readFile = async (path, enc) => {
  const text = await call("fs.readFile", path);
  return enc ? text : new TextEncoder().encode(text);
};
export const readdir = async (path, options) => {
  const r = await call("fs.readdir", path, options ?? null);
  return options?.withFileTypes ? r.map((d) => ({ name: d.name, isDirectory: () => d.dir })) : r;
};
export const exists = (path) => call("fs.exists", path);
export const writeFile = (path) => call("fs.write", path, "writeFile");
export const unlink = (path) => call("fs.write", path, "unlink");
export const rmdir = (path) => call("fs.write", path, "rmdir");
export const mkdir = (path) => call("fs.write", path, "mkdir");
export default { readFile, readdir, exists, writeFile, unlink, rmdir, mkdir };
