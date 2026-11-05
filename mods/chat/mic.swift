// Dictation's microphone on macOS (record.ts builds it with swiftc and runs it): the default input
// as 16 kHz mono 16-bit raw on stdout until it is killed. ffmpeg's avfoundation input drops most of
// the sound on recent macOS, Apple's own audio engine doesn't.
import AVFoundation

let engine = AVAudioEngine()
let input = engine.inputNode
let from = input.outputFormat(forBus: 0)
let to = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
guard let converter = AVAudioConverter(from: from, to: to) else { exit(1) }
let out = FileHandle.standardOutput
input.installTap(onBus: 0, bufferSize: 1600, format: from) { buf, _ in
  let room = AVAudioFrameCount(Double(buf.frameLength) * 16000 / from.sampleRate) + 16
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
do { try engine.start() } catch { exit(1) }
dispatchMain()
