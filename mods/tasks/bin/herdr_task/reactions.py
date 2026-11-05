"""Reactions (Settings › Agents › Reactions, on unless turned off): a space's Assistant reacts to
some of the person's messages with an emoji. Its words: an Assistant learns how at the start of
each session, with its settings block, and a running one is told once when the setting changes for
its space (assistant_settings.py). Workers are never told."""

# What an Assistant was last taught, on its terminal: "on" or "off".
LABEL = "herdr.reactions"

GUIDE = ("Reactions (on in Settings): react to some of the person's messages with one emoji, as a person would in a chat: "
         "👀 on a new ask you're picking up, 👍 on a go-ahead, ✅ on their ask once it's done, 😂 at a joke, 🙏 for thanks. "
         "Most messages get none; never more than one per message; never instead of an answer they need. "
         "Write it on a line of its own in the reply that ends your turn: <hc react=\"👀\" to=\"first words of their message\"/>. In to=, leave out double quotes or make them curly (“ ”). "
         "A message that needs no words back (a thanks, an ok, a joke) gets only the reaction: that line, then <hc no-reply/>, nothing else.")
TURNED_ON = "Reactions are now on in Settings. " + GUIDE.split(": ", 1)[1]
OFF = "Reactions are off in Settings: never react to the person's messages (no <hc react> lines)."
TURNED_OFF = "Reactions are now off in Settings: don't react to the person's messages any more (no <hc react> lines)."
