#!/usr/bin/env node

/**
 * Moonshine Node.js CLI
 *
 * A command-line interface for real-time speech-to-text using Moonshine.
 * Uses @mastra/node-audio for microphone input and TEN VAD for voice detection.
 *
 * Usage:
 *   moonshine-node              # Start transcription
 *   moonshine-node --help       # Show help
 *   moonshine-node --list-devices  # List available audio devices
 *
 * Controls:
 *   'q' or Ctrl+C - Quit
 */

import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import { NodeMicTranscriber } from "../nodeTranscriber.js";

// List available audio devices (Linux only)
function listDevices() {
  try {
    console.log("🔊 Available Audio Input Devices:\n");

    const output = execSync("arecord -L 2>/dev/null", { encoding: "utf-8" });
    const lines = output.split("\n");

    const devices = [];

    // Parse arecord -L output format:
    // device_name
    //     description line 1
    //     description line 2
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) continue;

      // Skip lines that start with spaces (description lines)
      if (line.startsWith(" ") || line.startsWith("\t")) continue;

      // Skip virtual/placeholder devices we don't want
      if (
        [
          "null",
          "lavrate",
          "samplerate",
          "speexrate",
          "jack",
          "oss",
          "speex",
          "upmix",
          "vdownmix",
        ].includes(trimmed)
      ) {
        i++; // Skip the next line (description)
        continue;
      }

      // Collect description lines
      const descriptions = [];
      let j = i + 1;
      while (
        j < lines.length &&
        (lines[j].startsWith(" ") || lines[j].startsWith("\t"))
      ) {
        const desc = lines[j].trim();
        if (desc) descriptions.push(desc);
        j++;
      }

      devices.push({
        name: trimmed,
        description: descriptions[0] || "No description",
        allDescriptions: descriptions,
      });
    }

    // Display devices with descriptions
    devices.forEach((device, idx) => {
      const num = idx + 1;
      console.log(`  ${num}. ${device.name}`);
      console.log(`     ${device.description}`);
    });

    console.log("\nUse --device flag to select a specific device.");
    if (devices.length > 0) {
      console.log(`Example: moonshine-node --device "${devices[0].name}"\n`);
    }
  } catch (error) {
    console.error("Could not list audio devices. Are you on Linux with ALSA?");
    console.error(error.message);
  }
  process.exit(0);
}

// Show help message
function showHelp() {
  console.log(`
Moonshine Node.js CLI
Real-time speech-to-text using Moonshine on-device models.

Usage:
  moonshine-node [options]

Options:
  --help           Show this help message
  --list-devices   List available audio input devices
  --device         ALSA device name (e.g., "sysdefault:CARD=Mini") [default: "default"]
  --model          Model to use (tiny, base) [default: tiny]
  --streaming      Enable streaming/partial updates [default: false]
  --once           Transcribe only one sentence and exit [default: false]
  --verbose        Show detailed logs (listening, speech detection, etc.) [default: false]

Controls:
  Press 'q' or Ctrl+C to quit

Example:
  moonshine-node
  moonshine-node --model base --streaming
  moonshine-node --once
`);
  process.exit(0);
}

// Main application
async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      "list-devices": { type: "boolean" },
      device: { type: "string" },
      model: { type: "string", default: "tiny" },
      streaming: { type: "boolean" },
      once: { type: "boolean" },
      verbose: { type: "boolean" },
    },
    strict: false,
  });

  // Handle list-devices flag
  if (values["list-devices"]) {
    listDevices();
  }

  // Handle help flag
  if (values.help) {
    showHelp();
  }

  // Map model name to URL
  const modelURL = values.model === "base" ? "model/base" : "model/tiny";

  if (values.verbose) {
    console.log("🌙 Moonshine Node.js CLI");
    console.log(`Model: ${values.model}`);
    console.log(`Streaming: ${values.streaming ? "enabled" : "disabled"}`);
    console.log(`Once mode: ${values.once ? "enabled" : "disabled"}`);
    if (values.device) {
      console.log(`Device: ${values.device}`);
    }
    console.log("");
  }

  let transcriptionCount = 0;

  // Create transcriber
  const transcriber = new NodeMicTranscriber(modelURL, {
    onModelLoadStarted: () => {
      if (values.verbose) console.log("⏳ Loading models...");
    },
    onModelLoaded: () => {
      if (values.verbose) {
        console.log("✓ Models loaded!");
        console.log("✓ Ready to transcribe");
        console.log("");
      }
    },
    onTranscribeStarted: () => {
      if (values.verbose) {
        console.log("🎤 Listening...");
        console.log("");
      }
    },
    onTranscribeStopped: () => {
      if (values.verbose) console.log("⏸ Paused");
    },
    onSpeechStart: () => {
      if (values.verbose) {
        process.stdout.write(`\r🗣️ Speaking...`);
      }
    },
    onSpeechContinuing: () => {
      if (values.verbose) {
        process.stdout.write(`\r🗣️ Speaking...`);
      }
    },
    onSpeechEnd: () => {
      if (values.verbose) {
        process.stdout.write("\r🤔 Processing...");
      }
    },
    onTranscriptionUpdated: (text) => {
      if (values.verbose) {
        process.stdout.write(`\r📝 ${text}`);
      }
    },
    onTranscriptionCommitted: (text) => {
      // Always output transcription, but format differently based on verbose mode
      if (values.verbose) {
        process.stdout.write("\r");
        console.log(`✓ "${text}"`);
        console.log("");
      } else {
        // Just output the raw text without quotes or formatting
        console.log(text);
      }

      transcriptionCount++;

      // Exit after one transcription if --once flag is set
      if (values.once && transcriptionCount >= 1) {
        if (values.verbose) console.log("Exiting after one transcription.");
        transcriber.destroy();
        process.exit(0);
      }
    },
    onError: (error) => {
      console.error(`✗ Error: ${error.message}`);
    },
  });

  // Handle keyboard input
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (key) => {
    if (key === "q" || key === "Q") {
      console.log("");
      console.log("Quitting...");
      transcriber.destroy();
      process.exit(0);
    }
  });

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    console.log("");
    console.log("Stopping...");
    transcriber.destroy();
    process.exit(0);
  });

  // Start transcription
  await transcriber.start();
}

// Run the application
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
