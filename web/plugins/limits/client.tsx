// Plan limits: 3.0 has no plan bars at the sidebar's foot and no Plan limits sheet. Each machine's plans are in its
// machine popup (the sidebar's machine meter, web/plugins/health), as the window's (mods/spaces-chat machine-popup.js),
// read and worded by the shared core (core/machines.js). The plugin stays, so the add-on's switch keeps its name.
import { definePlugin } from '@client/kernel.ts'

export default definePlugin({
  name: 'limits',
  setup() {},
})
