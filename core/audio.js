// The window's microphone and speaker, for dictation (mods/chat/record.ts) and voice calls (mods/chat/voice.ts).
// Linux: PipeWire's pw-record and pw-play, as always. macOS: herdr-audio, a small helper on Apple's own audio
// (mods/chat/mac-audio.swift) that mods/chat/audio.ts builds once with the Mac's swiftc. All of them read or write the
// same raw 16-bit mono at a rate the caller picks. This file is the plain part: which tool, its arguments, and the
// words people see when it can't work.

/** The helper's name: macOS shows it in the microphone prompt and in System Settings › Privacy & Security › Microphone. */
export const HELPER = "herdr-audio";

// herdr-audio's exit codes (mac-audio.swift).
export const DENIED = 3;
export const NO_DEVICE = 4;
export const FAILED = 5;
/** A call's echo cancellation (Apple's voice processing) isn't there: the call records and plays apart instead. */
export const NO_VOICE_PROCESSING = 6;

const PRIVACY = "System Settings › Privacy & Security › Microphone";

/** The words for a mic or speaker that can't work. what: "mic" | "speaker"; why: an exit code above, or a kind:
 *  "tools" (no swiftc), "build" (it didn't build), "pipewire" (Linux without pw-record/pw-play). detail: one line. */
export function audioWords(what, why, detail = "") {
  const tail = detail ? ` (${String(detail).trim().split("\n")[0].slice(0, 160)})` : "";
  if (why === DENIED) return `Herdr isn't allowed to use the microphone. Turn on ${HELPER} in ${PRIVACY}, then try again.`;
  if (why === NO_DEVICE) return what === "speaker"
    ? "No speaker found. Pick one in System Settings › Sound › Output, then try again."
    : "No microphone found. Plug one in or pick one in System Settings › Sound › Input, then try again.";
  if (why === "tools") return "The mic and speaker on a Mac need Apple's command line tools. Run xcode-select --install in a terminal, then try again.";
  if (why === "build") return `The Mac's audio helper didn't build${tail}.`;
  if (why === "pipewire") return `The ${what === "speaker" ? "speaker" : "microphone"} needs PipeWire's ${what === "speaker" ? "pw-play" : "pw-record"}.`;
  return `The ${what === "speaker" ? "speaker" : "microphone"} stopped${tail}.`;
}

/** Which tool records and plays here: "pipewire" (pw-record on the PATH: Linux, unchanged), "mac" (macOS), else null. */
export function audioKind(platform, has) {
  if (has("pw-record")) return "pipewire";
  if (platform === "darwin") return "mac";
  return null;
}

/** The command that writes the default microphone to stdout as raw 16-bit mono at rate. helper: herdr-audio's path. */
export function micArgs(kind, rate, helper = HELPER) {
  if (kind === "mac") return [helper, "record", String(rate)];
  return ["pw-record", "--rate", String(rate), "--channels", "1", "--format", "s16", "--raw", "-"];
}

/** The command that plays raw 16-bit mono at rate from stdin on the default speaker. */
export function speakerArgs(kind, rate, helper = HELPER) {
  if (kind === "mac") return [helper, "play", String(rate)];
  return ["pw-play", "--rate", String(rate), "--channels", "1", "--format", "s16", "--raw", "-"];
}

/** A voice call's mic and speaker in one, with echo cancellation, so the mic stays open while the agent speaks: the mic
 *  on stdout at inRate, stdin played at outRate, SIGUSR1 drops what's queued. Only herdr-audio on a Mac (PipeWire: null,
 *  the call records and plays apart). */
export function callArgs(kind, inRate, outRate, helper = HELPER) {
  if (kind === "mac") return [helper, "call", String(inRate), String(outRate)];
  return null;
}

/** herdr-audio's embedded Info.plist: its name and why it asks (macOS shows these words in the prompt). */
export const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dev.herdr.shepherdr.audio</string>
  <key>CFBundleName</key><string>${HELPER}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>NSMicrophoneUsageDescription</key><string>Herdr listens for dictation and voice calls, only while you use them.</string>
</dict></plist>
`;

/** swiftc's arguments to build herdr-audio from src into out, with the Info.plist at plist inside it. */
export function buildArgs(src, plist, out) {
  return ["swiftc", "-O", "-swift-version", "5", "-o", out, src,
    "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", plist];
}
