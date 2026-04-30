# Moonshine Node

On-device speech-to-text CLI for Node.js using Moonshine models.

## Features

- **Real-time transcription** - Speech-to-text with automatic voice activity detection
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
npx moonshine

# Use base model for better accuracy
npx moonshine --model base

# Transcribe one sentence and exit
npx moonshine --once

# Enable streaming/partial updates
npx moonshine --streaming

# Specify audio device (Linux/ALSA)
npx moonshine --device "sysdefault:CARD=Mini"

# List available audio devices
npx moonshine --list-devices

# Verbose output
npx moonshine --verbose
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--help` | Show help message | - |
| `--list-devices` | List available audio input devices | - |
| `--device` | ALSA device name | `default` |
| `--model` | Model to use (`tiny` or `base`) | `tiny` |
| `--streaming` | Enable streaming/partial updates | `false` |
| `--once` | Transcribe one sentence and exit | `false` |
| `--verbose` | Show detailed logs | `false` |

## Controls

- Press `q` or `Ctrl+C` to quit

## Models

- **tiny** (~14MB) - Faster, lower accuracy. Good for simple commands.
- **base** (~45MB) - Slower, better accuracy. Recommended for general use.

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
