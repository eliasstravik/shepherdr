// RFC-shaped ClientHello for gateway boundary tests; the native TLS-client case is separate.
export const tlsRecord = (bytes: Buffer) => { const header = Buffer.from([22, 3, 1, 0, 0]); header.writeUInt16BE(bytes.length, 3); return Buffer.concat([header, bytes]) }
export function clientHello(host: string, extra = Buffer.alloc(0), withSni = true) {
  const name = Buffer.from(host), list = Buffer.alloc(5)
  list.writeUInt16BE(name.length + 3, 0); list[2] = 0; list.writeUInt16BE(name.length, 3)
  const sni = Buffer.alloc(4); sni.writeUInt16BE(0, 0); sni.writeUInt16BE(list.length + name.length, 2)
  const extensions = Buffer.concat([...(withSni ? [sni, list, name] : []), extra]), length = Buffer.alloc(2); length.writeUInt16BE(extensions.length)
  const body = Buffer.concat([Buffer.from([3, 3]), Buffer.alloc(32), Buffer.from([0, 0, 2, 0xc0, 0x2f, 1, 0]), length, extensions])
  const hello = Buffer.alloc(4); hello[0] = 1; hello.writeUIntBE(body.length, 1, 3)
  return tlsRecord(Buffer.concat([hello, body]))
}
