import { expect, test } from "bun:test";
import { spaceName } from "./spaces.js";

test("a space is called as the window's sidebar calls it, never ~", () => {
  expect(spaceName({ name: "web", folder: "/x/y" })).toBe("web");
  expect(spaceName({ name: "~", folder: "/home/me" }, { home: "/home/me" })).toBe("Home");
  expect(spaceName({ name: "~", folder: "/tmp/abc/tt-repo" })).toBe("tt-repo");
  expect(spaceName({ name: "~", folder: "/Users/me/" })).toBe("Home");
  expect(spaceName({ name: "", folder: "/srv/app" }, { repo: "app-repo" })).toBe("app-repo");
  expect(spaceName({ name: "dev", folder: "/srv/app" }, { named: false, repo: "app" })).toBe("app");
});
