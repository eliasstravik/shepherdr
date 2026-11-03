# Updating and legacy

2.1 runs independently on herdr-core. Use reviewed source/builds and the
[standalone start guide](core/start.md). Its herdr plugin has the id `shepherdr`, not 2.0's
`herdr-projects`, so `herdr plugin update` never moves a 2.0 install onto 2.1. One installed
with `herdr plugin install` updates with `herdr plugin install eliasstravik/shepherdr --ref`
and the next reviewed release.
Do not follow main with an automatic source supervisor.

The complete legacy 2.0 implementation and its instructions remain on `v2.0`.
No existing data is imported into 2.1. The permanent 2.1 home is `~/.shepherdr`,
which is initialised fresh only after an approved backup/relocation of legacy state.
See the [cutover and rollback runbook](core/cutover.md).

For an already deployed 2.1 installation, stop the app, replace its reviewed build,
and start it again with the same home and a compatible core. Core agents remain
independent of the app. Retain the prior build and a consistent private state backup
for rollback. Never run two application writers on one home. Plugins are rebuilt
from the selected build/home; a failed plugin update keeps the working version.

Shepherdr never bumps its version, tags, releases or publishes on its own. A release needs the maintainer's separate
approval.
