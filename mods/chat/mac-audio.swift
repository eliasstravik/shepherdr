// herdr-audio: the Mac's own microphone and speaker for the window's dictation and voice calls (macOS has no pw-record
// or pw-play). mods/chat/audio.ts builds it with swiftc, once per change of this file, with core/audio.js's Info.plist
// inside it (its name and why it asks for the microphone).
//   herdr-audio record <rate>   the default microphone on stdout: raw 16-bit little-endian mono at <rate>
//   herdr-audio play <rate>     raw 16-bit little-endian mono at <rate> from stdin, on the default speaker
//   herdr-audio access          asks for the microphone (macOS's prompt, the first time) and says whether it may
// Exit codes (core/audio.js): 0 fine, 2 usage, 3 the microphone isn't allowed, 4 no microphone or speaker,
// 5 the audio failed. A short reason goes to stderr.
// Killed (SIGTERM, SIGINT) it stops at once: the speaker goes quiet mid-word, as pw-play does.

import AVFoundation
import Darwin
import Foundation

func fail(_ code: Int32, _ why: String) -> Never {
  fputs("herdr-audio: \(why)\n", stderr)
  exit(code)
}

// ---- its own permission ------------------------------------------------------------------------
// macOS asks about the app "responsible" for a process, normally whatever started it: the Herdr window (or the
// terminal it was opened from), which may have no words for a microphone prompt at all. herdr-audio disclaims that
// and runs itself again, so the prompt and the entry in Privacy & Security › Microphone are its own, whatever started
// it. Its parent stays only to pass signals on and hand back the exit code.

var child: pid_t = 0

func ownResponsibility() {
  if getenv("HERDR_AUDIO_OWN") != nil { return }
  typealias Disclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
  guard let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim") else { return }
  let disclaim = unsafeBitCast(sym, to: Disclaim.self)
  var attr: posix_spawnattr_t? = nil
  guard posix_spawnattr_init(&attr) == 0 else { return }
  defer { posix_spawnattr_destroy(&attr) }
  guard disclaim(&attr, 1) == 0 else { return }
  setenv("HERDR_AUDIO_OWN", "1", 1)
  let path = Bundle.main.executablePath ?? CommandLine.arguments[0]
  let argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
  var pid: pid_t = 0
  let rc = argv.withUnsafeBufferPointer { posix_spawn(&pid, path, nil, &attr, $0.baseAddress, _NSGetEnviron().pointee) }
  if rc != 0 { unsetenv("HERDR_AUDIO_OWN"); return } // runs here instead
  child = pid
  for s in [SIGTERM, SIGINT, SIGHUP] { signal(s) { sig in _ = kill(child, sig) } }
  // the program that started it gone (killed outright): the child goes too, even mid-prompt
  let parent = getppid()
  let watch = DispatchSource.makeTimerSource(queue: .global())
  watch.schedule(deadline: .now() + 0.5, repeating: 0.5)
  watch.setEventHandler { if getppid() != parent { kill(child, SIGTERM); exit(0) } }
  watch.resume()
  keep.append(watch)
  var status: Int32 = 0
  while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
  let sig = status & 0x7f
  exit(sig == 0 ? (status >> 8) & 0xff : 128 + sig)
}

// Ends with the program that started it (its parent gone: nobody reads or writes the audio any more).
func endWithParent() {
  let parent = getppid()
  let t = DispatchSource.makeTimerSource(queue: .global())
  t.schedule(deadline: .now() + 0.5, repeating: 0.5)
  t.setEventHandler { if getppid() != parent { exit(0) } }
  t.resume()
  keep.append(t)
}
var keep: [Any] = []

// ---- the microphone ----------------------------------------------------------------------------

func mayListen() -> Bool {
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .authorized: return true
  case .notDetermined:
    let done = DispatchSemaphore(value: 0)
    final class Answer { var ok = false }
    let a = Answer()
    AVCaptureDevice.requestAccess(for: .audio) { ok in a.ok = ok; done.signal() }
    done.wait()
    return a.ok
  default: return false
  }
}

/** All of data to stdout; the reader gone ends this. */
func writeOut(_ p: UnsafeRawPointer, _ count: Int) {
  var off = 0
  while off < count {
    let r = write(1, p + off, count - off)
    if r < 0 && errno == EINTR { continue }
    if r <= 0 { exit(0) }
    off += r
  }
}

func record(_ rate: Double) -> Never {
  guard mayListen() else { fail(3, "the microphone isn't allowed") }
  guard let outFmt = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 1, interleaved: true) else {
    fail(5, "no format for \(rate) Hz")
  }
  let engine = AVAudioEngine()
  // (again when the input changes: headphones plugged in, another default microphone)
  func start() {
    let input = engine.inputNode
    input.removeTap(onBus: 0)
    let inFmt = input.outputFormat(forBus: 0)
    guard inFmt.sampleRate > 0, inFmt.channelCount > 0 else { fail(4, "no microphone") }
    guard let conv = AVAudioConverter(from: inFmt, to: outFmt) else { fail(5, "can't convert \(inFmt) to \(outFmt)") }
    conv.downmix = true
    input.installTap(onBus: 0, bufferSize: 2048, format: inFmt) { buf, _ in
      let cap = AVAudioFrameCount(Double(buf.frameLength) * rate / inFmt.sampleRate) + 64
      guard let out = AVAudioPCMBuffer(pcmFormat: outFmt, frameCapacity: cap) else { return }
      var given = false
      var err: NSError?
      let st = conv.convert(to: out, error: &err) { _, status in
        if given { status.pointee = .noDataNow; return nil }
        given = true
        status.pointee = .haveData
        return buf
      }
      guard st != .error, out.frameLength > 0, let ch = out.int16ChannelData else { return }
      writeOut(UnsafeRawPointer(ch[0]), Int(out.frameLength) * 2)
    }
    engine.prepare()
    do { try engine.start() } catch { fail(5, "the microphone didn't start: \(error.localizedDescription)") }
  }
  keep.append(NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { _ in
    engine.stop()
    start()
  })
  start()
  dispatchMain()
}

// ---- the speaker -------------------------------------------------------------------------------

func play(_ rate: Double) -> Never {
  guard let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false) else {
    fail(5, "no format for \(rate) Hz")
  }
  let engine = AVAudioEngine()
  let node = AVAudioPlayerNode()
  engine.attach(node)
  engine.connect(node, to: engine.mainMixerNode, format: fmt)
  func start() {
    engine.prepare()
    do { try engine.start() } catch { fail(4, "no speaker: \(error.localizedDescription)") }
    node.play()
  }
  // (again when the output changes; what was waiting to play is dropped, as a talked-over agent's would be)
  keep.append(NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { _ in
    start()
  })
  start()
  let playing = DispatchGroup()
  Thread.detachNewThread {
    var carry: [UInt8] = []
    var chunk = [UInt8](repeating: 0, count: 8192)
    while true {
      let r = read(0, &chunk, chunk.count)
      if r < 0 && errno == EINTR { continue }
      if r <= 0 { break }
      carry.append(contentsOf: chunk[0..<r])
      let n = carry.count / 2
      if n == 0 { continue }
      guard let pcm = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(n)), let f = pcm.floatChannelData?[0] else { continue }
      pcm.frameLength = AVAudioFrameCount(n)
      for i in 0..<n { f[i] = Float(Int16(bitPattern: UInt16(carry[2 * i]) | UInt16(carry[2 * i + 1]) << 8)) / 32768 }
      carry = carry.count % 2 == 1 ? [carry[carry.count - 1]] : []
      playing.enter()
      node.scheduleBuffer(pcm) { playing.leave() }
    }
    // stdin closed: what's left plays out, then it ends
    _ = playing.wait(timeout: .now() + 30)
    exit(0)
  }
  dispatchMain()
}

// ---- main --------------------------------------------------------------------------------------

let args = CommandLine.arguments
let mode = args.count > 1 ? args[1] : ""
let rate = args.count > 2 ? Double(args[2]) ?? 0 : 0
guard mode == "access" || ((mode == "record" || mode == "play") && rate >= 8000 && rate <= 192000) else {
  fail(2, "usage: herdr-audio record <rate> | play <rate> | access")
}
ownResponsibility()
endWithParent()
switch mode {
case "access": if mayListen() { print("allowed"); exit(0) } else { fail(3, "the microphone isn't allowed") }
case "record": record(rate)
default: play(rate)
}
