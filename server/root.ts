// The standalone application checkout; no supervisor follows or switches branches.
import { join } from 'node:path'

export const ROOT = process.env.SHEPHERDR_ROOT ?? join(import.meta.dir, '..')
