/**
 * WAV File Transcriber
 *
 * Reads WAV audio files and transcribes them using Moonshine models.
 * Supports standard PCM WAV files (16-bit, mono/stereo, various sample rates).
 */

import { readFileSync } from "node:fs";
import { NodeMoonshineModel } from "./nodeMoonshineModel.js";

/**
 * Parse a WAV file and return audio samples as Float32Array normalized to [-1, 1].
 * Supports 16-bit PCM, mono and stereo (averages channels).
 *
 * @param {string} filePath - Path to the WAV file
 * @returns {{ samples: Float32Array, sampleRate: number }}
 */
export function parseWav(filePath) {
  const buffer = readFileSync(filePath);

  // Verify RIFF header
  const riff = buffer.slice(0, 4).toString();
  if (riff !== "RIFF") {
    throw new Error("Not a valid WAV file (missing RIFF header)");
  }

  // Verify WAVE format
  const wave = buffer.slice(8, 12).toString();
  if (wave !== "WAVE") {
    throw new Error("Not a valid WAV file (missing WAVE header)");
  }

  // Parse chunks to find 'fmt ' and 'data'
  let offset = 12;
  let fmtData = null;
  let dataChunk = null;

  while (offset < buffer.length) {
    const chunkId = buffer.slice(offset, offset + 4).toString();
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkData = buffer.slice(offset + 8, offset + 8 + chunkSize);

    if (chunkId === "fmt ") {
      fmtData = chunkData;
    } else if (chunkId === "data") {
      dataChunk = chunkData;
    }

    // Move to next chunk (chunk size is rounded up to even)
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (!fmtData) {
    throw new Error("WAV file missing 'fmt' chunk");
  }
  if (!dataChunk) {
    throw new Error("WAV file missing 'data' chunk");
  }

  // Parse fmt chunk
  const audioFormat = fmtData.readUInt16LE(0);
  const numChannels = fmtData.readUInt16LE(2);
  const sampleRate = fmtData.readUInt32LE(4);
  const bitsPerSample = fmtData.readUInt16LE(14);

  if (audioFormat !== 1) {
    throw new Error(
      `Unsupported WAV format: ${audioFormat} (only 16-bit PCM is supported)`
    );
  }

  if (bitsPerSample !== 16) {
    throw new Error(
      `Unsupported bits per sample: ${bitsPerSample} (only 16-bit is supported)`
    );
  }

  // Convert 16-bit PCM samples to Float32 normalized to [-1, 1]
  const numSamples = dataChunk.length / 2;
  const rawSamples = new Int16Array(
    dataChunk.buffer,
    dataChunk.byteOffset,
    numSamples
  );

  // If stereo, average the channels; if mono, just convert
  let samples;
  if (numChannels === 1) {
    samples = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      samples[i] = rawSamples[i] / 32768.0;
    }
  } else {
    // Average left and right channels
    const monoSamples = new Float32Array(numSamples / numChannels);
    for (let i = 0; i < monoSamples.length; i++) {
      let sum = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        sum += rawSamples[i * numChannels + ch];
      }
      monoSamples[i] = (sum / numChannels) / 32768.0;
    }
    samples = monoSamples;
  }

  return { samples, sampleRate };
}

/**
 * Transcribe a WAV file using the Moonshine model.
 *
 * @param {string} filePath - Path to the WAV file
 * @param {string} [modelURL='model/tiny'] - Model to use ('model/tiny' or 'model/base')
 * @param {boolean} [verbose=false] - Enable verbose logging
 * @returns {Promise<string>} The transcribed text
 */
export async function transcribeFile(
  filePath,
  modelURL = "model/tiny",
  verbose = false
) {
  const { samples, sampleRate } = parseWav(filePath);

  if (verbose) {
    console.log(
      `[FileTranscriber] Loaded WAV: ${samples.length} samples, ${sampleRate} Hz, ${(samples.length / sampleRate).toFixed(2)}s`
    );
  }

  const model = new NodeMoonshineModel(modelURL, "quantized", verbose);
  await model.loadModel();

  // Moonshine expects 16kHz audio. Resample if needed.
  let audioSamples = samples;
  if (sampleRate !== 16000) {
    if (verbose) {
      console.log(
        `[FileTranscriber] Resampling from ${sampleRate} Hz to 16000 Hz`
      );
    }
    audioSamples = resample(samples, sampleRate, 16000);
  }

  return model.generate(audioSamples);
}

/**
 * Simple resampling using linear interpolation.
 *
 * @param {Float32Array} samples - Input samples
 * @param {number} fromRate - Original sample rate
 * @param {number} toRate - Target sample rate
 * @returns {Float32Array} Resampled audio
 */
function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;

  const ratio = fromRate / toRate;
  const newLength = Math.round(samples.length / ratio);
  const resampled = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;

    if (index + 1 < samples.length) {
      resampled[i] =
        samples[index] * (1 - fraction) + samples[index + 1] * fraction;
    } else {
      resampled[i] = samples[index];
    }
  }

  return resampled;
}
