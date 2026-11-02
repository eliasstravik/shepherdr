// Trusted Git SSH transport only. This is not an agent/core link and is never mounted into a runtime.
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { pilotConfigPath } from './core-pilot-path.ts'

const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`
const configQuote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const hostName = (value: string) => /^(?:[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}|(?:\[[a-fA-F0-9:]+\]|[a-fA-F0-9]*:[a-fA-F0-9:]+))$/.test(value) && !['.', '..'].includes(value)
const userName = (value: string) => /^[a-zA-Z0-9_][a-zA-Z0-9_.+-]{0,127}$/.test(value)
const SAFE = new Set(`addressfamily batchmode bindaddress bindinterface canonicaldomains canonicalizemaxdots canonicalizefallbacklocal challengeresponseauthentication checkhostip ciphers compression connecttimeout connectionattempts enableescapecommand escapechar fingerprinthash hashknownhosts hostbasedauthentication hostbasedacceptedalgorithms hostbasedkeytypes hostkeyalgorithms hostkeyalias hostname identitiesonly identityfile identityagent certificatefile ipqos kbdinteractiveauthentication kbdinteractivedevices kexalgorithms loglevel logverbose macs nohostauthenticationforlocalhost numberofpasswordprompts passwordauthentication port preferredauthentications pubkeyacceptedalgorithms pubkeyacceptedkeytypes pubkeyauthentication rekeylimit requesttty requiredrsasize revokedhostkeys serveralivecountmax serveraliveinterval stricthostkeychecking tcpkeepalive updatehostkeys user userknownhostsfile globalknownhostsfile verifyhostkeydns visualhostkey proxyjump host match include tag gssapiauthentication gssapitrustdns usekeychain ignoreunknown`.split(' '))
const PATHS = new Set(['identityfile', 'certificatefile', 'identityagent', 'userknownhostsfile', 'globalknownhostsfile', 'revokedhostkeys'])
const IGNORE = new Set(['sendenv', 'setenv', 'forwardagent', 'forwardx11', 'forwardx11trusted', 'localforward', 'remoteforward', 'dynamicforward', 'controlmaster', 'controlpath', 'controlpersist', 'addkeystoagent', 'forkafterauthentication', 'sessiontype', 'stdinnull', 'canonicalizehostname', 'clearallforwardings', 'gssapidelegatecredentials'])

/** No shell evaluation: SSH configuration tokens, including quoted spaces and trailing comments. */
export function pilotSshWords(line: string) {
  const words: string[] = []; let word = '', open = '', started = false
  for (let n = 0; n < line.length; n++) {
    const c = line[n]
    if (!open && c === '#') break
    if (c === '\\') { if (++n >= line.length) throw Error('Incomplete SSH configuration escape'); word += line[n]; started = true; continue }
    if (open) { if (c === open) open = ''; else word += c; started = true; continue }
    if (c === '"' || c === "'") { open = c; started = true; continue }
    if (/\s/.test(c) || c === '=' && words.length === 0) { if (started) { words.push(word); word = ''; started = false }; continue }
    word += c; started = true
  }
  if (open) throw Error('Unclosed SSH configuration quote')
  if (started) words.push(word)
  return words
}
function owned(path: string, privateOnly = false) {
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid?.() && info.uid !== 0 || info.mode & (privateOnly ? 0o077 : 0o022)) throw Error('SSH configuration must be an owned, protected regular file')
  return info
}
export async function preparePilotSsh(input: { cwd: string; ssh: string; validate(path: string): void; userConfig?: string; systemConfig?: string; home?: string; parent?: string }) {
  const home = input.home ?? homedir(), root = mkdtempSync(join(input.parent ?? tmpdir(), 'shep-git-ssh-'))
  try {
    input.validate(root)
    const expanded = (value: string, base: string) => {
      value = value.replace(/\$\{HOME\}|%d/g, home).replace(/%u/g, userInfo().username).replace(/%i/g, String(process.getuid?.() ?? ''))
      if (value.includes('%') || value.includes('$') || /^~[^/]/.test(value)) throw Error('Use static SSH identity/configuration paths for checked Git; dynamic host/environment paths need an explicit adapter')
      return resolve(base, value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value)
    }
    const resource = (value: string) => {
      if (value === 'none' || value === 'SSH_AUTH_SOCK' && !process.env.SSH_AUTH_SOCK) return
      const path = expanded(value === 'SSH_AUTH_SOCK' ? process.env.SSH_AUTH_SOCK! : value, input.cwd)
      input.validate(path)
    }
    for (const name of ['id_rsa', 'id_ecdsa', 'id_ed25519', 'id_dsa', 'id_ecdsa_sk', 'id_ed25519_sk', 'known_hosts', 'known_hosts2']) {
      resource(join(home, '.ssh', name))
      if (name.startsWith('id_')) resource(join(home, '.ssh', name + '-cert.pub'))
    }
    if (process.env.SSH_AUTH_SOCK) resource(process.env.SSH_AUTH_SOCK)
    const copies = new Map<string, string>(); let total = 0, lines = 0
    const copy = async (path: string, base: string, ancestors: Set<string>): Promise<string> => {
      input.validate(path)
      const canonical = realpathSync(path), identity = `${base}\0${canonical}`
      if (ancestors.has(identity)) throw Error('SSH configuration includes a cycle')
      const previous = copies.get(identity); if (previous) return previous
      if (copies.size >= 1024) throw Error('Too many SSH configuration files')
      const info = owned(canonical); total += info.size
      if (info.size > 2 * 1024 * 1024 || total > 8 * 1024 * 1024) throw Error('SSH configuration is too large')
      const fd = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      let text: string
      try { const current = fstatSync(fd); if (current.ino !== info.ino || current.dev !== info.dev || !current.isFile()) throw Error('SSH configuration changed while reading'); text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(fd)) } finally { closeSync(fd) }
      if (text.includes('\0')) throw Error('Invalid SSH configuration')
      const target = join(root, `${copies.size}.conf`); copies.set(identity, target)
      const output: string[] = [], next = new Set([...ancestors, identity])
      for (const line of text.split(/\r?\n/)) {
        if (++lines > 32768) throw Error('Too many SSH configuration lines')
        const words = pilotSshWords(line); if (!words.length) continue
        const key = words.shift()!.toLowerCase()
        if (words[0] === '=') words.shift()
        if (IGNORE.has(key)) continue
        if (!SAFE.has(key)) throw Error(`SSH ${key} needs an explicit safe adapter for checked Git; no host command was executed`)
        if (!words.length) throw Error('SSH configuration has a missing value')
        if (key === 'include') {
          const included: string[] = []
          for (const pattern of words) {
            const absolute = expanded(pattern, base); input.validate(absolute)
            if (/\*\*|[{}]/.test(absolute)) throw Error('Use ordinary SSH Include wildcards (*, ? or character classes) for checked Git')
            const matches: string[] = []
            for (const match of new Bun.Glob(absolute).scanSync({ onlyFiles: false, followSymlinks: false })) {
              if (matches.length >= 1024) throw Error('Too many SSH include matches')
              matches.push(match)
            }
            matches.sort()
            for (const match of matches) included.push(await copy(match, base, next))
          }
          if (included.length) output.push(`Include ${included.map(configQuote).join(' ')}`)
          continue
        }
        if (key === 'match') {
          for (let n = 0; n < words.length; n++) {
            const criterion = words[n].replace(/^!/, '').toLowerCase()
            if (['all', 'canonical', 'final'].includes(criterion)) continue
            if (!['host', 'originalhost', 'user', 'localuser', 'tagged', 'command'].includes(criterion) || ++n >= words.length) throw Error('This SSH Match condition needs an explicit safe adapter')
          }
        }
        if (key === 'hostname' && (words.length !== 1 || !hostName(words[0].replace(/%h/g, 'host')))) throw Error('Invalid SSH HostName')
        if (key === 'user' && (words.length !== 1 || !userName(words[0]))) throw Error('Invalid SSH user')
        if (key === 'proxyjump' && words.length !== 1) throw Error('Use one comma-separated SSH ProxyJump list')
        if (key === 'proxyjump') for (const jump of words.join('').split(',')) {
          if (jump === 'none') continue
          if (!/^(?:[a-zA-Z0-9_.+-]+@)?(?:[a-zA-Z0-9][a-zA-Z0-9._-]*|\[[a-fA-F0-9:]+\])(?::[0-9]{1,5})?$/.test(jump)) throw Error('Use literal SSH ProxyJump host names for checked Git')
        }
        if (key === 'ignoreunknown' && words.some(word => word.toLowerCase() !== 'usekeychain')) throw Error('Unsupported SSH IgnoreUnknown declaration')
        if (PATHS.has(key)) {
          for (let n = 0; n < words.length; n++) {
            if (words[n] === 'none') continue
            if (words[n] === 'SSH_AUTH_SOCK') { resource(words[n]); continue }
            words[n] = expanded(words[n], input.cwd); resource(words[n])
            if (key === 'identityfile') resource(words[n] + '-cert.pub')
          }
        }
        // OpenSSH parses ProxyJump as a raw remainder, unlike ordinary token-valued options.
        output.push(`${key} ${key === 'proxyjump' ? words[0] : words.map(configQuote).join(' ')}`)
      }
      writeFileSync(target, output.join('\n') + '\n', { mode: 0o600, flag: 'wx' }); return target
    }
    const includes: string[] = []
    for (const [file, base] of [[input.userConfig ?? join(home, '.ssh/config'), join(home, '.ssh')], [input.systemConfig ?? '/etc/ssh/ssh_config', '/etc/ssh']]) {
      input.validate(file)
      if (existsSync(file)) includes.push(await copy(file, base, new Set()))
    }
    const config = join(root, 'config'), profile = join(root, 'profile.json')
    writeFileSync(config, includes.map(file => `Include ${configQuote(file)}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' })
    writeFileSync(profile, JSON.stringify({ ssh: input.ssh, config }), { mode: 0o600, flag: 'wx' })
    return { profile, close: () => rmSync(root, { recursive: true, force: true }) }
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error }
}

export function pilotSshArgs(words: string[]) {
  if (words.length > 32 || words.some(word => typeof word !== 'string' || word.includes('\0') || word.length > 8192)) throw Error('Invalid checked SSH arguments')
  const flags: string[] = []; let probe = false, n = 0
  while (words[n]?.startsWith('-')) {
    const word = words[n++]
    if (word === '-G') probe = true
    else if (word === '-4' || word === '-6') flags.push(word)
    else if (word === '-p' && /^[0-9]{1,5}$/.test(words[n] || '') && Number(words[n]) >= 1 && Number(words[n]) <= 65535) flags.push(word, words[n++])
    else if (word === '-o' && words[n] === 'SendEnv=GIT_PROTOCOL') n++
    else throw Error('Unsupported checked Git SSH option')
  }
  const destination = words[n++], split = destination?.lastIndexOf('@') ?? -1
  const user = split >= 0 ? destination.slice(0, split) : undefined, host = split >= 0 ? destination.slice(split + 1) : destination
  if (!host || !hostName(host) || user !== undefined && !userName(user)) throw Error('Invalid checked Git SSH destination')
  if (probe && n === words.length) return { probe, args: [] as string[] }
  if (probe || n !== words.length - 1) throw Error('Checked SSH only runs one Git service')
  const command = words[n], service = command.match(/^(git-upload-pack|git-receive-pack) /)?.[1]
  if (!service) throw Error('Checked SSH only runs standard Git services')
  const raw = command.slice(service.length + 1)
  // Git quotes repository paths with single quotes and escaped quote fragments. No expansion is evaluated.
  let path = '', inside = false
  for (let p = 0; p < raw.length; p++) {
    const c = raw[p]
    if (c === "'") { inside = !inside; continue }
    if (!inside && c === '\\' && p + 1 < raw.length) { path += raw[++p]; continue }
    if (!inside && !/[a-zA-Z0-9_./~:@+!-]/.test(c)) throw Error('Invalid Git service path quoting')
    path += c
  }
  if (inside || !path || path.startsWith('-') || /[\r\n\0]/.test(path)) throw Error('Invalid Git service path')
  return { probe: false, args: [...flags, destination, `${service} ${quote(path)}`] }
}

if (import.meta.main) {
  let prepared: Awaited<ReturnType<typeof preparePilotSsh>> | undefined
  try {
    const [file, ...args] = process.argv.slice(2); const info = owned(file, true)
    if (info.size > 4 * 1024 * 1024) throw Error('Checked SSH request is too large')
    const parent = lstatSync(dirname(file)); if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid?.() || parent.mode & 0o077) throw Error('Invalid checked SSH request directory')
    const request = JSON.parse(readFileSync(file, 'utf8')) as { cwd: string; writableRoots: string[] }
    if (!isAbsolute(request.cwd) || !Array.isArray(request.writableRoots) || request.writableRoots.length > 8192 || request.writableRoots.some(path => typeof path !== 'string' || !isAbsolute(path) || resolve(path) === '/')) throw Error('Invalid checked SSH request')
    const checked = pilotSshArgs(args)
    if (checked.probe) process.exit(0)
    const validate = (path: string) => {
      const canonical = pilotConfigPath(path)
      if (request.writableRoots.some(root => [resolve(path), canonical].some(value => value === root || value.startsWith(root + '/')))) throw Error('SSH account/configuration may not come from a writable contained workspace')
    }
    const ssh = Bun.which('ssh', { PATH: process.env.PATH })
    if (!ssh) throw Error('Install OpenSSH for checked repository SSH')
    validate(ssh); validate(realpathSync(ssh))
    prepared = await preparePilotSsh({ cwd: request.cwd, ssh: realpathSync(ssh), validate, parent: dirname(file) })
    const profile = JSON.parse(readFileSync(prepared.profile, 'utf8')) as { ssh: string; config: string }
    const env = { HOME: homedir(), PATH: '/usr/bin:/bin', SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK, ...(process.env.GIT_PROTOCOL && /^version=[0-9]$/.test(process.env.GIT_PROTOCOL) ? { GIT_PROTOCOL: process.env.GIT_PROTOCOL } : {}) }
    const child = Bun.spawn([profile.ssh, '-F', profile.config, '-oBatchMode=yes', '-oStrictHostKeyChecking=yes', '-oClearAllForwardings=yes', '-oForwardAgent=no', '-oForwardX11=no', '-oControlMaster=no', '-oControlPath=none', '-oControlPersist=no', '-oPermitLocalCommand=no', '-oAddKeysToAgent=no', '-oCanonicalizeHostname=no', '-oPKCS11Provider=none', '-oSecurityKeyProvider=internal', '-oSendEnv=GIT_PROTOCOL', '-oRequestTTY=no', '-oEscapeChar=none', '-oGSSAPIDelegateCredentials=no', '-oHostbasedAuthentication=no', ...checked.args], { env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
    process.exitCode = await child.exited
  } catch (error) { console.error((error as Error).message); process.exitCode = 1 }
  finally { prepared?.close() }
}
