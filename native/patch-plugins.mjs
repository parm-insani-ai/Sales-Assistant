// Small fixes to native plugin sources, applied after `npm install` (the
// postinstall script) so every build — a laptop's or the workflow's — gets
// them without anyone remembering to.
//
// Speech recognition: the plugin installs a microphone tap with whatever
// format the input node reports. When the audio session isn't ready for
// recording yet (the first tap after permission is granted, another app
// holding the microphone, a Bluetooth route mid-switch), that format is
// 0 Hz / 0 channels, and installing a tap with it is fatal — iOS kills the
// app on the spot, which is what the salesperson sees as "it crashed when I
// tapped the mic". A guard turns that into an error the app can say out
// loud and recover from.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const swift = resolve(root, "node_modules/@capgo/capacitor-speech-recognition/ios/Sources/SpeechRecognitionPlugin/SpeechRecognitionPlugin.swift");

if (!existsSync(swift)) {
  console.log("patch-plugins: speech plugin not installed, nothing to do");
} else {
  const src = readFileSync(swift, "utf8");
  const anchor = "        let recordingFormat = inputNode.outputFormat(forBus: 0)\n";
  const guard = anchor +
    "        // viniva: a 0 Hz / 0-channel format means the input isn't ready; installing a tap with it is fatal.\n" +
    "        guard recordingFormat.sampleRate > 0, recordingFormat.channelCount > 0 else {\n" +
    "            call.reject(\"The microphone isn't ready yet. Try again in a moment.\")\n" +
    "            cleanupRecognition(notifyStop: false)\n" +
    "            return\n" +
    "        }\n";
  if (src.includes("recordingFormat.sampleRate > 0")) {
    console.log("patch-plugins: speech plugin already guarded");
  } else if (!src.includes(anchor)) {
    console.error("patch-plugins: the speech plugin's source has changed; the microphone guard was NOT applied. Check native/patch-plugins.mjs against the plugin.");
    process.exitCode = 1;
  } else {
    writeFileSync(swift, src.replace(anchor, guard));
    console.log("patch-plugins: speech plugin guarded against an empty microphone format");
  }
}
