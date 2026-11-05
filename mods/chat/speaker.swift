// A voice call's speaker on macOS (audio.ts builds it with swiftc, voice.ts runs it): raw 16-bit mono
// at the rate given (16000 when none) from stdin, played on the default output as it comes. Killing it
// stops the sound at once; the end of stdin lets what's queued finish first.
import AVFoundation

let rate = CommandLine.arguments.count > 1 ? Double(CommandLine.arguments[1]) ?? 16000 : 16000
let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false)!
let engine = AVAudioEngine()
let node = AVAudioPlayerNode()
engine.attach(node)
engine.connect(node, to: engine.mainMixerNode, format: format)
do { try engine.start() } catch { exit(1) }
node.play()

// Done once heard, not once handed to the output (by its value: the SDKs name this case differently).
let played = AVAudioPlayerNodeCompletionCallbackType(rawValue: 2)!
let lock = NSLock()
var queued = 0, eof = false
func done() {
  lock.lock(); let over = eof && queued == 0; lock.unlock()
  if over { exit(0) }
}

var carry = Data()
while true {
  let data = FileHandle.standardInput.availableData
  if data.isEmpty { break }
  carry.append(data)
  let n = carry.count / 2
  if n == 0 { continue }
  let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(n))!
  buf.frameLength = AVAudioFrameCount(n)
  let out = buf.floatChannelData![0]
  carry.withUnsafeBytes { raw in
    for i in 0..<n { out[i] = Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self))) / 32768 }
  }
  carry = Data(carry.suffix(carry.count % 2))
  lock.lock(); queued += 1; lock.unlock()
  node.scheduleBuffer(buf, completionCallbackType: played) { _ in
    lock.lock(); queued -= 1; lock.unlock()
    done()
  }
}
lock.lock(); eof = true; lock.unlock()
done()
dispatchMain()
