#!/usr/bin/env python3
# The desktop's own file picker (xdg-desktop-portal FileChooser), several files at once, for the
# chat's attach button: prints each chosen path on its own line; nothing when cancelled.
# Herdr's mods have a folder picker only (pickFolder), so the chat runs this.
#
# It talks to the portal with PyGObject when this Python has it, else over the session bus itself (plain sockets,
# D-Bus's own wire format: many Pythons, NixOS's for one, have no PyGObject, GitHub #1225). With no portal it tries
# zenity, then kdialog. When it can't open a picker it exits 1 with why on stderr, one plain line, for the chat to
# show beside its + button.
import os
import shutil
import socket
import struct
import subprocess
import sys
from urllib.parse import unquote, urlparse

PORTAL = "org.freedesktop.portal.Desktop"
OBJ = "/org/freedesktop/portal/desktop"
TIMEOUT = 30 * 60  # the person may take a while to choose


class Why(Exception):
    """Why no picker opened, in plain words."""


def file_paths(uris):
    out = []
    for uri in uris:
        u = urlparse(uri)
        if u.scheme == "file":
            out.append(unquote(u.path))
    return out


# ---- with PyGObject ----------------------------------------------------------------------------

def pick_gi(title, token):
    from gi.repository import Gio, GLib
    try:
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    except GLib.Error as e:
        raise Why(f"no session bus ({e.message})")
    sender = bus.get_unique_name()[1:].replace(".", "_")
    path = f"/org/freedesktop/portal/desktop/request/{sender}/{token}"
    loop = GLib.MainLoop()
    chosen = []

    def response(_bus, _sender, _path, _iface, _signal, params):
        code, results = params.unpack()
        if code == 0:
            chosen.extend(file_paths(results.get("uris", [])))
        loop.quit()

    # Listen before asking, so the answer can't come first.
    bus.signal_subscribe(PORTAL, "org.freedesktop.portal.Request", "Response", path, None, Gio.DBusSignalFlags.NONE, response)
    try:
        bus.call_sync(PORTAL, OBJ, "org.freedesktop.portal.FileChooser", "OpenFile",
                      GLib.Variant("(ssa{sv})", ("", title, {
                          "handle_token": GLib.Variant("s", token),
                          "multiple": GLib.Variant("b", True),
                          "accept_label": GLib.Variant("s", "Attach"),
                      })), GLib.VariantType("(o)"), Gio.DBusCallFlags.NONE, -1, None)
    except GLib.Error as e:
        raise Why(portal_why(Gio.DBusError.get_remote_error(e) or "", e.message))
    loop.run()
    return chosen


def portal_why(name, message):
    if name.endswith(("ServiceUnknown", "NameHasNoOwner")):
        return "xdg-desktop-portal isn't running"
    if name.endswith(("UnknownInterface", "UnknownMethod", "UnknownObject")):
        return "the desktop portal has no file chooser (install a portal backend, e.g. xdg-desktop-portal-gtk)"
    return f"the desktop portal refused ({message or name})"


# ---- D-Bus's wire format, for the session bus without PyGObject ---------------------------------
# Only what the FileChooser call needs: the basic types, strings, variants, arrays, structs and dict entries.

ALIGN = {"y": 1, "b": 4, "n": 2, "q": 2, "i": 4, "u": 4, "x": 8, "t": 8, "d": 8, "h": 4, "s": 4, "o": 4, "g": 1,
         "v": 1, "a": 4, "(": 8, "{": 8}
FIXED = {"y": "B", "b": "I", "n": "h", "q": "H", "i": "i", "u": "I", "x": "q", "t": "Q", "d": "d", "h": "I"}


def one_type(sig, i=0):
    """The end of the single complete type that starts at sig[i]."""
    c = sig[i]
    if c == "a":
        return one_type(sig, i + 1)
    if c in "({":
        close = ")" if c == "(" else "}"
        j = i + 1
        while sig[j] != close:
            j = one_type(sig, j)
        return j + 1
    return i + 1


def types_of(sig):
    out, i = [], 0
    while i < len(sig):
        j = one_type(sig, i)
        out.append(sig[i:j])
        i = j
    return out


class Writer:
    def __init__(self):
        self.b = bytearray()

    def pad(self, n):
        self.b += b"\0" * (-len(self.b) % n)

    def put(self, t, v):
        c = t[0]
        self.pad(ALIGN[c])
        if c in FIXED:
            self.b += struct.pack("<" + FIXED[c], int(bool(v)) if c == "b" else v)
        elif c in "so":
            s = v.encode()
            self.b += struct.pack("<I", len(s)) + s + b"\0"
        elif c == "g":
            s = v.encode()
            self.b += bytes([len(s)]) + s + b"\0"
        elif c == "v":
            sig, val = v
            self.put("g", sig)
            self.put(sig, val)
        elif c == "a":
            elem = t[1:]
            at = len(self.b)
            self.b += b"\0\0\0\0"
            self.pad(ALIGN[elem[0]])
            start = len(self.b)
            for x in (v.items() if isinstance(v, dict) else v):
                self.put(elem, x)
            struct.pack_into("<I", self.b, at, len(self.b) - start)
        elif c in "({":
            for ft, fv in zip(types_of(t[1:-1]), v):
                self.put(ft, fv)


class Reader:
    def __init__(self, data, order="<", at=0):
        self.d, self.o, self.i = data, order, at

    def pad(self, n):
        self.i += -self.i % n

    def get(self, t):
        c = t[0]
        self.pad(ALIGN[c])
        if c in FIXED:
            f = self.o + FIXED[c]
            (v,) = struct.unpack_from(f, self.d, self.i)
            self.i += struct.calcsize(f)
            return bool(v) if c == "b" else v
        if c in "so":
            (n,) = struct.unpack_from(self.o + "I", self.d, self.i)
            v = self.d[self.i + 4:self.i + 4 + n].decode("utf-8", "replace")
            self.i += 5 + n
            return v
        if c == "g":
            n = self.d[self.i]
            v = self.d[self.i + 1:self.i + 1 + n].decode()
            self.i += 2 + n
            return v
        if c == "v":
            return self.get(self.get("g"))
        if c == "a":
            (n,) = struct.unpack_from(self.o + "I", self.d, self.i)
            self.i += 4
            elem = t[1:]
            self.pad(ALIGN[elem[0]])
            end, out = self.i + n, []
            while self.i < end:
                out.append(self.get(elem))
            return dict(out) if elem[0] == "{" else out
        if c in "({":
            return tuple(self.get(ft) for ft in types_of(t[1:-1]))
        raise ValueError(f"D-Bus type {c!r}")


# header field codes
F_PATH, F_INTERFACE, F_MEMBER, F_ERROR, F_REPLY, F_DEST, F_SENDER, F_SIG = 1, 2, 3, 4, 5, 6, 7, 8
FIELD_SIG = {F_PATH: "o", F_INTERFACE: "s", F_MEMBER: "s", F_ERROR: "s", F_REPLY: "u", F_DEST: "s", F_SENDER: "s", F_SIG: "g"}
CALL, RETURN, ERROR, SIGNAL = 1, 2, 3, 4


def message(kind, serial, fields, sig="", body=()):
    """One D-Bus message (little-endian)."""
    b = Writer()
    for t, v in zip(types_of(sig), body):
        b.put(t, v)
    if sig:
        fields = {**fields, F_SIG: sig}
    h = Writer()
    h.b += struct.pack("<cBBBII", b"l", kind, 0, 1, len(b.b), serial)
    h.put("a(yv)", [(code, (FIELD_SIG[code], v)) for code, v in fields.items()])
    h.pad(8)
    return bytes(h.b + b.b)


def bus_address():
    addr = os.environ.get("DBUS_SESSION_BUS_ADDRESS", "")
    if not addr:
        run = os.environ.get("XDG_RUNTIME_DIR")
        if run and os.path.exists(os.path.join(run, "bus")):
            return os.path.join(run, "bus")
        raise Why("no session bus (DBUS_SESSION_BUS_ADDRESS isn't set)")
    for part in addr.split(";"):
        kind, _, rest = part.partition(":")
        kv = dict(x.split("=", 1) for x in rest.split(",") if "=" in x)
        if kind == "unix" and "path" in kv:
            return unquote(kv["path"])
        if kind == "unix" and "abstract" in kv:
            return "\0" + unquote(kv["abstract"])
    raise Why(f"the session bus's address isn't one this can reach ({addr})")


class Bus:
    def __init__(self, address):
        self.s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.s.settimeout(TIMEOUT)
        try:
            self.s.connect(address)
        except OSError as e:
            raise Why(f"can't reach the session bus ({e.strerror or e})")
        self.buf, self.serial, self.early = b"", 0, []
        self.s.sendall(b"\0AUTH EXTERNAL " + str(os.getuid()).encode().hex().encode() + b"\r\n")
        line = self.line()
        if not line.startswith(b"OK"):
            raise Why("the session bus refused this program")
        self.s.sendall(b"BEGIN\r\n")
        self.name = self.call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "Hello")[0]

    def line(self):
        while b"\r\n" not in self.buf:
            got = self.s.recv(4096)
            if not got:
                raise Why("the session bus closed the connection")
            self.buf += got
        line, _, self.buf = self.buf.partition(b"\r\n")
        return line

    def need(self, n):
        while len(self.buf) < n:
            got = self.s.recv(65536)
            if not got:
                raise Why("the session bus closed the connection")
            self.buf += got

    def read(self):
        """The next message: (kind, fields, body)."""
        self.need(16)
        order = "<" if self.buf[0:1] == b"l" else ">"
        kind = self.buf[1]
        body_len, self.last, fields_len = struct.unpack_from(order + "III", self.buf, 4)  # last: its serial
        head = 16 + fields_len + (-(16 + fields_len) % 8)
        self.need(head + body_len)
        data, self.buf = self.buf[:head + body_len], self.buf[head + body_len:]
        fields = dict((code, v) for code, v in Reader(data, order, 12).get("a(yv)"))
        sig = fields.get(F_SIG, "")
        r = Reader(data[head:], order)
        return kind, fields, tuple(r.get(t) for t in types_of(sig))

    def send(self, dest, path, iface, member, sig="", body=()):
        self.serial += 1
        self.s.sendall(message(CALL, self.serial, {F_PATH: path, F_INTERFACE: iface, F_MEMBER: member, F_DEST: dest}, sig, body))
        return self.serial

    def call(self, *args, **kw):
        """A method call's answer; a D-Bus error raises (name, message). Signals meanwhile are kept for wait()."""
        serial = self.send(*args, **kw)
        while True:
            kind, f, body = self.read()
            if kind in (RETURN, ERROR) and f.get(F_REPLY) == serial:
                if kind == ERROR:
                    raise BusError(f.get(F_ERROR, ""), body[0] if body and isinstance(body[0], str) else "")
                return body
            if kind == SIGNAL:
                self.early.append((f, body))

    def signal(self, path, iface, member):
        """Waits for that signal; its body."""
        for f, body in self.early:
            if (f.get(F_PATH), f.get(F_INTERFACE), f.get(F_MEMBER)) == (path, iface, member):
                return body
        while True:
            kind, f, body = self.read()
            if kind == SIGNAL and (f.get(F_PATH), f.get(F_INTERFACE), f.get(F_MEMBER)) == (path, iface, member):
                return body


class BusError(Exception):
    pass


def pick_wire(title, token):
    bus = Bus(bus_address())
    sender = bus.name[1:].replace(".", "_")
    path = f"/org/freedesktop/portal/desktop/request/{sender}/{token}"
    rule = "type='signal',interface='org.freedesktop.portal.Request',member='Response',path='%s'"
    # Listen before asking, so the answer can't come first.
    bus.call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "AddMatch", "s", (rule % path,))
    try:
        (handle,) = bus.call(PORTAL, OBJ, "org.freedesktop.portal.FileChooser", "OpenFile", "ssa{sv}",
                             ("", title, {"handle_token": ("s", token), "multiple": ("b", True), "accept_label": ("s", "Attach")}))
    except BusError as e:
        raise Why(portal_why(*e.args))
    if handle != path:  # an older portal names its own request
        bus.call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "AddMatch", "s", (rule % handle,))
    code, results = bus.signal(handle, "org.freedesktop.portal.Request", "Response")
    return file_paths(results.get("uris", [])) if code == 0 else []


# ---- without a portal ----------------------------------------------------------------------------

def pick_dialog(title):
    """zenity's or kdialog's picker; None when neither is here."""
    if shutil.which("zenity"):
        r = subprocess.run(["zenity", "--file-selection", "--multiple", "--separator=\n", f"--title={title}"],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True)
        return r.stdout.splitlines() if r.returncode == 0 else []
    if shutil.which("kdialog"):
        r = subprocess.run(["kdialog", "--title", title, "--multiple", "--separator", "\n", "--getopenfilename", os.path.expanduser("~")],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True)
        return r.stdout.splitlines() if r.returncode == 0 else []
    return None


def main():
    title = sys.argv[1] if len(sys.argv) > 1 else "Attach files"
    token = "herdr_chat_%d" % int.from_bytes(os.urandom(4), "little")
    try:
        try:
            import gi  # noqa: F401
            from gi.repository import Gio, GLib  # noqa: F401
            have_gi = os.environ.get("HERDR_PICK_NO_GI") is None
        except ImportError:
            have_gi = False
        chosen = pick_gi(title, token) if have_gi else pick_wire(title, token)
    except (Why, OSError, ValueError, struct.error) as e:
        chosen = pick_dialog(title)
        if chosen is None:
            why = str(e) if isinstance(e, Why) else f"the session bus answered in a way this can't read ({e})"
            print(why, file=sys.stderr)
            return 1
    print("\n".join(chosen))
    return 0


if __name__ == "__main__":
    sys.exit(main())
