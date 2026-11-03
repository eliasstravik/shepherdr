#!/usr/bin/env python3
# The desktop's own file picker (xdg-desktop-portal FileChooser), several files at once, for the
# chat's attach button: prints each chosen path on its own line; nothing when cancelled.
# Herdr's mods have a folder picker only (pickFolder), so the chat runs this.
import sys
from urllib.parse import unquote, urlparse

from gi.repository import Gio, GLib

title = sys.argv[1] if len(sys.argv) > 1 else "Attach files"
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
token = f"herdr_chat_{GLib.random_int()}"
sender = bus.get_unique_name()[1:].replace(".", "_")
path = f"/org/freedesktop/portal/desktop/request/{sender}/{token}"
loop = GLib.MainLoop()
chosen = []


def response(_bus, _sender, _path, _iface, _signal, params):
    code, results = params.unpack()
    if code == 0:
        for uri in results.get("uris", []):
            u = urlparse(uri)
            if u.scheme == "file":
                chosen.append(unquote(u.path))
    loop.quit()


# Listen before asking, so the answer can't come first.
bus.signal_subscribe("org.freedesktop.portal.Desktop", "org.freedesktop.portal.Request", "Response",
                     path, None, Gio.DBusSignalFlags.NONE, response)
bus.call_sync("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop",
              "org.freedesktop.portal.FileChooser", "OpenFile",
              GLib.Variant("(ssa{sv})", ("", title, {
                  "handle_token": GLib.Variant("s", token),
                  "multiple": GLib.Variant("b", True),
                  "accept_label": GLib.Variant("s", "Attach"),
              })), GLib.VariantType("(o)"), Gio.DBusCallFlags.NONE, -1, None)
loop.run()
print("\n".join(chosen))
