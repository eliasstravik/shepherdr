import { expect, test } from "bun:test";
import { meOf } from "./tailscale.ts";

const status = (id: string) =>
  `{"Self":{"UserID":${id},"HostName":"box","DNSName":"box.tailnet.example."},` +
  `"User":{"${id}":{"ID":${id},"LoginName":"me@example.com","DisplayName":"Me"}}}`;

test("the owner and name from tailscale status", () =>
  expect(meOf(status("12345"))).toEqual({ login: "me@example.com", name: "Me", dns: "box.tailnet.example", host: "box" }));

test("a UserID past 2^53 still finds its owner", () =>
  expect(meOf(status("9007199254740993"))?.login).toBe("me@example.com"));

test("no owner or no name: null", () => {
  expect(meOf(`{"Self":{"UserID":1,"DNSName":"box.tailnet.example."},"User":{}}`)).toBeNull();
  expect(meOf("not json")).toBeNull();
});
