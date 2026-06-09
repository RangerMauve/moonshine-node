# Moonshine Node

On-device speech-to-text CLI for Node.js using Moonshine models.

## Features

- **Real-time transcription** - Speech-to-text with automatic voice activity detection
- **File transcription** - Transcribe WAV files directly from the CLI
- **On-device processing** - No data leaves your machine
- **Multiple models** - Choose between `tiny` (faster) or `base` (more accurate) models
- **Streaming mode** - Get partial transcriptions as you speak
- **Linux audio support** - Uses ALSA via @mastra/node-audio

## Installation

```bash
npm install
```

## Usage

```bash
# Basic usage (tiny model)
npx moonshine-node

# Transcribe a WAV file
npx moonshine-node --file audio.wav

# Use base model for better accuracy
npx moonshine-node --model base

# Transcribe one sentence and exit
npx moonshine-node --once

# Enable streaming/partial updates
npx moonshine-node --streaming

# Specify audio device (Linux/ALSA)
npx moonshine-node --device "sysdefault:CARD=Mini"

# List available audio devices
npx moonshine-node --list-devices

# Verbose output
npx moonshine-node --verbose
```

## Options

| Option           | Description                        | Default   |
| ---------------- | ---------------------------------- | --------- |
| `--help`         | Show help message                  | -         |
| `--list-devices` | List available audio input devices | -         |
| `--file`         | WAV file to transcribe             | -         |
| `--device`       | ALSA device name                   | `default` |
| `--model`        | Model to use (`tiny` or `base`)    | `tiny`    |
| `--streaming`    | Enable streaming/partial updates   | `false`   |
| `--once`         | Transcribe one sentence and exit   | `false`   |
| `--verbose`      | Show detailed logs                 | `false`   |

## Controls

- Press `q` or `Ctrl+C` to quit

## Models

- **tiny** (~14MB) - Faster, lower accuracy. Good for simple commands.
- **base** (~45MB) - Slower, better accuracy. Recommended for general use.

## File Transcription

Transcribe WAV audio files directly:

```bash
npx moonshine-node --file audio.wav
npx moonshine-node --file audio.wav --model base
```

**Supported format:** 16-bit PCM WAV files (16kHz recommended, other sample rates are auto-resampled).

## Requirements

- Node.js 18+
- Linux (for microphone input via ALSA)
- `arecord` (ALSA utility) installed

## Architecture

- **VAD**: TEN VAD for voice activity detection
- **STT**: Moonshine ONNX models for speech-to-text
- **Audio**: @mastra/node-audio for microphone input
- **Runtime**: onnxruntime-node for inference

## License

MIT
