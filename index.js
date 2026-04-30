#!/usr/bin/env node

/**
 * Moonshine Node.js CLI
 * 
 * A command-line interface for real-time speech-to-text using Moonshine.
 * Uses @mastra/node-audio for microphone input and TEN VAD for voice detection.
 * 
 * Usage:
 *   node index.js              # Start transcription
 *   node index.js --help       # Show help
 *   node index.js --list-devices  # List available audio devices
 * 
 * Controls:
 *   'q' or Ctrl+C - Quit
 */

import { execSync } from 'child_process';
import { NodeMicTranscriber } from './nodeTranscriber.js';

// ANSI escape codes for terminal output
const CLEAR_LINE = '\r\x1b[K';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[36m';

// List available audio devices (Linux only)
function listDevices() {
  try {
    console.log(`${BLUE}🔊 Available Audio Input Devices:${RESET}\n`);

    const output = execSync('arecord -L 2>/dev/null', { encoding: 'utf-8' });
    const lines = output.split('\n');

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
      if (line.startsWith(' ') || line.startsWith('\t')) continue;
      
      // Skip virtual/placeholder devices we don't want
      if (['null', 'lavrate', 'samplerate', 'speexrate', 'jack', 'oss', 'speex', 'upmix', 'vdownmix'].includes(trimmed)) {
        i++; // Skip the next line (description)
        continue;
      }
      
      // Collect description lines
      const descriptions = [];
      let j = i + 1;
      while (j < lines.length && (lines[j].startsWith(' ') || lines[j].startsWith('\t'))) {
        const desc = lines[j].trim();
        if (desc) descriptions.push(desc);
        j++;
      }
      
      devices.push({
        name: trimmed,
        description: descriptions[0] || 'No description',
        allDescriptions: descriptions
      });
    }
    
    // Display devices with descriptions
    devices.forEach((device, idx) => {
      const num = idx + 1;
      console.log(`  ${num}. ${device.name}`);
      console.log(`     ${device.description}`);
    });

    console.log(`\n${YELLOW}Use --device flag to select a specific device.${RESET}`);
    if (devices.length > 0) {
      console.log(`Example: node index.js --device "${devices[0].name}"\n`);
    }
  } catch (error) {
    console.error(`${YELLOW}Could not list audio devices. Are you on Linux with ALSA?${RESET}`);
    console.error(error.message);
  }
  process.exit(0);
}

// Show help message
function showHelp() {
  console.log(`
${BOLD}Moonshine Node.js CLI${RESET}
Real-time speech-to-text using Moonshine on-device models.

${BOLD}Usage:${RESET}
  node index.js [options]

${BOLD}Options:${RESET}
  --help           Show this help message
  --list-devices   List available audio input devices
  --device         ALSA device name (e.g., "sysdefault:CARD=Mini") [default: "default"]
  --model          Model to use (tiny, base) [default: tiny]
  --streaming      Enable streaming/partial updates [default: false]
  --once           Transcribe only one sentence and exit [default: false]
  --verbose        Show detailed logs (listening, speech detection, etc.) [default: false]

${BOLD}Controls:${RESET}
  Press 'q' or Ctrl+C to quit

${BOLD}Example:${RESET}
  node index.js
  node index.js --model base --streaming
  node index.js --once
`);
  process.exit(0);
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    model: 'tiny',
    streaming: false,
    once: false,
    device: undefined,
    listDevices: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h':
        showHelp();
        break;
      case '--list-devices':
        options.listDevices = true;
        break;
      case '--device':
        options.device = args[++i] || 'default';
        break;
      case '--model':
        options.model = args[++i] || 'tiny';
        break;
      case '--streaming':
        options.streaming = true;
        break;
      case '--once':
        options.once = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
    }
  }

  return options;
}

// Main application
async function main() {
  const options = parseArgs();
  
  // Handle list-devices flag
  if (options.listDevices) {
    listDevices();
  }
  
  // Map model name to URL
  const modelURL = options.model === 'base' ? 'model/base' : 'model/tiny';

  if (options.verbose) {
    console.log(`${BLUE}🌙 Moonshine Node.js CLI${RESET}`);
    console.log(`Model: ${options.model}`);
    console.log(`Streaming: ${options.streaming ? 'enabled' : 'disabled'}`);
    console.log(`Once mode: ${options.once ? 'enabled' : 'disabled'}`);
    if (options.device) {
      console.log(`Device: ${options.device}`);
    }
    console.log('');
  }

  let transcriptionCount = 0;

  // Create transcriber
  const transcriber = new NodeMicTranscriber(modelURL, {
    onModelLoadStarted: () => {
      if (options.verbose) console.log(`${YELLOW}⏳ Loading models...${RESET}`);
    },
    onModelLoaded: () => {
      if (options.verbose) {
        console.log(`${GREEN}✓ Models loaded!${RESET}`);
        console.log(`${GREEN}✓ Ready to transcribe${RESET}`);
        console.log('');
      }
    },
    onTranscribeStarted: () => {
      if (options.verbose) {
        console.log(`${BLUE}🎤 Listening...${RESET}`);
        console.log('');
      }
    },
    onTranscribeStopped: () => {
      if (options.verbose) console.log(`${YELLOW}⏸ Paused${RESET}`);
    },
    onSpeechStart: () => {
      if (options.verbose) {
        process.stdout.write(CLEAR_LINE + `${GREEN}🗣️ Speaking...${RESET}`);
      }
    },
    onSpeechContinuing: () => {
      if (options.verbose) {
        process.stdout.write(CLEAR_LINE + `${GREEN}🗣️ Speaking...${RESET}`);
      }
    },
    onSpeechEnd: () => {
      if (options.verbose) {
        process.stdout.write(CLEAR_LINE + `${YELLOW}🤔 Processing...${RESET}`);
      }
    },
    onTranscriptionUpdated: (text) => {
      if (options.verbose) {
        process.stdout.write(CLEAR_LINE + `${BLUE}📝 ${text}${RESET}`);
      }
    },
    onTranscriptionCommitted: (text) => {
      // Always output transcription, but format differently based on verbose mode
      if (options.verbose) {
        process.stdout.write(CLEAR_LINE);
        console.log(`${GREEN}✓ "${text}"${RESET}`);
        console.log('');
      } else {
        // Just output the raw text without quotes or formatting
        console.log(text);
      }

      transcriptionCount++;

      // Exit after one transcription if --once flag is set
      if (options.once && transcriptionCount >= 1) {
        if (options.verbose) console.log(`${YELLOW}Exiting after one transcription.${RESET}`);
        transcriber.destroy();
        process.exit(0);
      }
    },
    onError: (error) => {
      console.error(`${YELLOW}✗ Error: ${error.message}${RESET}`);
    },
  }, options.streaming, options.device, options.verbose);

  // Handle keyboard input
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (key) => {
    if (key === 'q' || key === 'Q') {
      console.log('');
      console.log(`${YELLOW}Quitting...${RESET}`);
      transcriber.destroy();
      process.exit(0);
    }
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('');
    console.log(`${YELLOW}Stopping...${RESET}`);
    transcriber.destroy();
    process.exit(0);
  });

  // Start transcription
  await transcriber.start();
}

// Run the application
main().catch((error) => {
  console.error(`${YELLOW}Fatal error:${RESET}`, error);
  process.exit(1);
});
