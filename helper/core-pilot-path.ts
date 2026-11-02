import { lstatSync, realpathSync, readlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** Resolve missing include targets too: a currently absent file must not become executable configuration later. */
export function pilotConfigPath(path: string, depth = 0): string {
  if (depth > 128) throw Error('Git configuration path is too deep or contains a symlink loop')
  path = resolve(path)
  try { return realpathSync(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try { if (lstatSync(path).isSymbolicLink()) return pilotConfigPath(resolve(dirname(path), readlinkSync(path)), depth + 1) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (dirname(path) === path) throw Error('Git configuration path cannot be resolved')
    return join(pilotConfigPath(dirname(path), depth + 1), basename(path))
  }
}

