// The microphone on macOS for dictation and voice calls (audio.ts builds it with swiftc): the default
// input as mono 16-bit raw at the rate given (16000 when none) on stdout until it is killed. ffmpeg's
// avfoundation input drops most of the sound on recent macOS, Apple's own audio engine doesn't.
import AVFoundation

// Why it stopped goes to stderr (a call's log).
func fail(_ why: String) -> Never {
  FileHandle.standardError.write("mic: \(why)\n".data(using: .utf8)!)
  exit(1)
}

let rate = CommandLine.arguments.count > 1 ? Double(CommandLine.arguments[1]) ?? 16000 : 16000
let engine = AVAudioEngine()
let input = engine.inputNode
let from = input.outputFormat(forBus: 0)
let to = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 1, interleaved: true)!
guard let converter = AVAudioConverter(from: from, to: to) else { fail("can't convert \(from) to \(to)") }
let out = FileHandle.standardOutput
input.installTap(onBus: 0, bufferSize: 1600, format: from) { buf, _ in
  let room = AVAudioFrameCount(Double(buf.frameLength) * rate / from.sampleRate) + 16
  guard let pcm = AVAudioPCMBuffer(pcmFormat: to, frameCapacity: room) else { return }
  var given = false
  converter.convert(to: pcm, error: nil) { _, status in
    if given { status.pointee = .noDataNow; return nil }
    given = true
    status.pointee = .haveData
    return buf
  }
  out.write(Data(bytes: pcm.int16ChannelData![0], count: Int(pcm.frameLength) * 2))
}
do { try engine.start() } catch { fail("didn't start: \(error.localizedDescription)") }
// The input device changed (another picked, one plugged in): the engine has stopped, so say so and end rather than
// go quiet.
NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { _ in
  fail("the input device changed")
}
dispatchMain()
