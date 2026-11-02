import type { CoreFiles } from './files.ts'

export const MAX_NATIVE_RECORD = 64 * 1024 * 1024

export interface NativeLine { text: string; offset: number }
interface Chunk { data: string; from: number; size: number; identity: string; anchor: string; modified: string }
// A stateless bounded read, executed by core on the owning machine. Unlike core
// file.read, it does not load the entire native log or impose a whole-file limit.
const script = `const f=require('node:fs'),x=JSON.parse(await Bun.stdin.text());const fd=f.openSync(x.path,f.constants.O_RDONLY|f.constants.O_NONBLOCK);try{const s=f.fstatSync(fd);if(!s.isFile())throw Error('Native log is not a regular file');const identity=[s.dev,s.ino,s.birthtimeMs].join(':');const modified=[s.mtimeMs,s.ctimeMs].join(':');function anchor(at){const b=Buffer.alloc(Math.min(64,at));const n=f.readSync(fd,b,0,b.length,at-b.length);return b.subarray(0,n).toString('base64')}let from=x.from;if(!Number.isSafeInteger(from)||from<0)throw Error('Invalid native log offset');if(identity!==x.identity||s.size<from||(s.size===from&&x.modified!==modified)||(from&&anchor(from)!==x.anchor))from=0;const b=Buffer.alloc(Math.min(1048576,Math.max(0,s.size-from)));let n=0;while(n<b.length){const got=f.readSync(fd,b,n,b.length-n,from+n);if(!got)break;n+=got}process.stdout.write(JSON.stringify({data:b.subarray(0,n).toString('base64'),from,size:s.size,identity,modified,anchor:anchor(from+n)}))}finally{f.closeSync(fd)}`

/** Retains only an unfinished line, with byte offsets preserved across UTF-8 chunks. */
export class CoreNativeFile {
  private position = 0
  private identity = ''
  private anchor = ''
  private modified = ''
  private skipping = false
  private carry: Buffer[] = []
  private carried = 0
  private offset = 0
  constructor(readonly path: string) {}
  get complete() { return !this.carried && !this.skipping }
  async read(files: CoreFiles, machine: string, bun: string, reset: () => void): Promise<{ lines: NativeLine[]; more: boolean; oversized?: boolean }> {
    const result = JSON.parse((await files.exec(machine, [bun, '-e', script], undefined,
      Buffer.from(JSON.stringify({ path: this.path, from: this.position, identity: this.identity, anchor: this.anchor, modified: this.modified })))).toString('utf8')) as Chunk
    if (result.from !== this.position || result.identity !== this.identity) {
      this.carry = []; this.carried = 0; this.skipping = false; this.offset = result.from; reset()
    }
    const bytes = Buffer.from(result.data, 'base64')
    this.position = result.from + bytes.length; this.identity = result.identity; this.anchor = result.anchor; this.modified = result.modified
    const lines: NativeLine[] = []
    let from = 0, oversized = false
    while (from < bytes.length) {
      const end = bytes.indexOf(10, from), until = end < 0 ? bytes.length : end
      const part = bytes.subarray(from, until)
      if (!this.skipping && this.carried + part.length > MAX_NATIVE_RECORD) {
        this.carry = []; this.carried = 0; this.skipping = true; oversized = true
      }
      if (!this.skipping && part.length) { this.carry.push(part); this.carried += part.length }
      if (end < 0) break
      if (!this.skipping) {
        let text = Buffer.concat(this.carry, this.carried).toString('utf8')
        if (text.endsWith('\r')) text = text.slice(0, -1)
        if (text.trim()) lines.push({ text, offset: this.offset })
      }
      this.offset = result.from + end + 1
      this.carry = []; this.carried = 0; this.skipping = false
      from = end + 1
    }
    return { lines, more: this.position < result.size, oversized: oversized || undefined }
  }
}
