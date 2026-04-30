/**
 * Node.js Microphone Transcriber
 *
 * Bridges @mastra/node-audio microphone input with Moonshine speech-to-text.
 * Uses TEN VAD for voice activity detection in Node.js environment.
 */

import { NodeVAD } from './nodeVAD.js';
import { getMicrophoneStream } from '@mastra/node-audio';
import { NodeMoonshineModel } from './nodeMoonshineModel.js';

// VAD settings (matching vad-moonshine defaults)
const TEN_VAD_THRESHOLD = 0.5;
const TEN_VAD_FRAME_SIZE = 256;
const VAD_REDEMPTION_FRAMES = 8;
const VAD_PRE_SPEECH_PAD_FRAMES = 32;  // ~512ms of pre-speech padding
const VAD_MIN_SPEECH_FRAMES = 20;      // Minimum frames for valid speech
const SPEECH_MAX_DURATION_MS = 30000;
const STT_MINIMUM_INTERVAL_MS = 200;

/**
 * @typedef {Object} NodeTranscriberCallbacks
 * @property {function(Error):void} onError
 * @property {function():void} onModelLoadStarted
 * @property {function():void} onModelLoaded
 * @property {function():void} onTranscribeStarted
 * @property {function():void} onTranscribeStopped
 * @property {function(string, Float32Array):void} onTranscriptionUpdated
 * @property {function(string, Float32Array):void} onTranscriptionCommitted
 * @property {function():void} onSpeechStart
 * @property {function(Float32Array):void} onSpeechEnd
 * @property {function(Float32Array):void} onSpeechContinuing
 */

/** @type {NodeTranscriberCallbacks} */
const defaultCallbacks = {
  onError: (error) => console.error('Error:', error),
  onModelLoadStarted: () => console.log('Loading models...'),
  onModelLoaded: () => console.log('Models loaded, ready to transcribe'),
  onTranscribeStarted: () => console.log('Transcription started'),
  onTranscribeStopped: () => console.log('Transcription stopped'),
  onTranscriptionUpdated: (text) => console.log('Partial:', text),
  onTranscriptionCommitted: (text) => console.log('Transcript:', text),
  onSpeechStart: () => console.log('Speech started'),
  onSpeechEnd: () => console.log('Speech ended'),
  onSpeechContinuing: () => {},
};

/**
 * Node.js transcriber that works with microphone input via @mastra/node-audio
 */
export class NodeMicTranscriber {
  #vad;
  #model;
  #callbacks;
  #micStream;
  #isActive;
  #partialUpdates;
  #isSttRunning;
  #lastSttFinishedTimeMs;
  #device;
  #verbose;

  /**
   * @param {string} [modelURL='model/tiny']
   * @param {NodeTranscriberCallbacks} [callbacks={}]
   * @param {boolean} [partialUpdates=true]
   * @param {string} [device='default']
   * @param {boolean} [verbose=false]
   */
  constructor(modelURL = 'model/tiny', callbacks = {}, partialUpdates = true, device = 'default', verbose = false) {
    this.#callbacks = { ...defaultCallbacks, ...callbacks };
    this.#partialUpdates = partialUpdates;
    this.#isActive = false;
    this.#isSttRunning = false;
    this.#lastSttFinishedTimeMs = 0;
    this.#micStream = null;
    this.#device = device;
    this.#verbose = verbose;
    
    // Create model instance directly
    this.#model = new NodeMoonshineModel(modelURL, 'quantized', verbose);

    this.#vad = new NodeVAD({
      onVoiceStart: (audio) => this.#onVoiceStart(audio),
      onVoiceEnd: (audio) => this.#onVoiceEnd(audio),
      onVoiceContinuing: (audio) => this.#onVoiceContinuing(audio),
      positiveSpeechThreshold: TEN_VAD_THRESHOLD,
      frameSize: TEN_VAD_FRAME_SIZE,
      redemptionFrames: VAD_REDEMPTION_FRAMES,
      preSpeechPadFrames: VAD_PRE_SPEECH_PAD_FRAMES,
      minSpeechFrames: VAD_MIN_SPEECH_FRAMES,
      verbose: this.#verbose,
    });
  }

  async load() {
    this.#callbacks.onModelLoadStarted();
    
    await this.#model.loadModel();
    await this.#vad.load();
    this.#callbacks.onModelLoaded();
  }

  async start() {
    if (this.#isActive) return;

    // Load models if not already loaded
    if (!this.#model.isLoaded() || !this.#vad.isLoaded()) {
      await this.load();
    }

    this.#isActive = true;
    this.#callbacks.onTranscribeStarted();

    // Suppress arecord command output unless verbose
    const originalStderrWrite = process.stderr.write;
    if (!this.#verbose) {
      process.stderr.write = () => false; // Suppress stderr
    }

    // Get microphone stream with optional device selection
    const micOptions = { rate: 16000, device: this.#device };
    if (this.#verbose) console.log(`[Transcriber] Using audio device: ${this.#device}`);

    this.#micStream = getMicrophoneStream(micOptions);

    // Restore stderr after stream is created
    if (!this.#verbose) {
      process.stderr.write = originalStderrWrite;
    }

    this.#micStream.on('data', (chunk) => {
      this.#onAudioData(chunk);
    });

    this.#micStream.on('error', (err) => {
      this.#callbacks.onError(err);
    });
  }

  stop() {
    this.#isActive = false;
    this.#callbacks.onTranscribeStopped();
    
    if (this.#micStream) {
      this.#micStream.destroy();
      this.#micStream = null;
    }
  }

  #onAudioData(chunk) {
    if (this.#verbose) console.log(`[Audio] Received chunk: ${chunk.length} bytes = ${chunk.length/2} samples`);

    const float32Audio = new Float32Array(chunk.length / 2);
    const int16Data = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);

    for (let i = 0; i < int16Data.length; i++) {
      float32Audio[i] = int16Data[i] / 32768.0;
    }

    this.#vad.processAudio(float32Audio);
  }

  #onVoiceStart(audio) {
    this.#lastSttFinishedTimeMs = Date.now();
    this.#callbacks.onSpeechStart();
  }

  #onVoiceEnd(audio) {
    const localAudioBuffer = Float32Array.from(audio);
    if (this.#verbose) console.log(`[Transcriber] onVoiceEnd: ${localAudioBuffer.length} samples`);

    // Check audio stats
    const maxVal = Math.max(...Array.from(localAudioBuffer).map(Math.abs));
    const minVal = Math.min(...Array.from(localAudioBuffer));
    const meanVal = localAudioBuffer.reduce((a, b) => a + Math.abs(b), 0) / localAudioBuffer.length;
    if (this.#verbose) console.log(`[Transcriber] Audio stats: max=${maxVal.toFixed(4)}, min=${minVal.toFixed(4)}, mean=${meanVal.toFixed(4)}`);

    // Skip if audio amplitude is too low (likely silence/noise)
    if (maxVal < 0.01) {
      if (this.#verbose) console.log(`[Transcriber] Skipping - audio amplitude too low (max=${maxVal.toFixed(4)})`);
      return;
    }

    this.#callbacks.onSpeechEnd(localAudioBuffer);
    this.#isSttRunning = true;
    
    this.#model?.generate(localAudioBuffer).then((text) => {
      if (this.#verbose) console.log(`[Transcriber] Transcription result: "${text}"`);
      this.#callbacks.onTranscriptionCommitted(text, localAudioBuffer);
      this.#lastSttFinishedTimeMs = Date.now();
      this.#isSttRunning = false;
    }).catch(err => {
      console.error(`[Transcriber] Transcription error:`, err);
      this.#callbacks.onError(err);
      this.#isSttRunning = false;
    });
  }

  #onVoiceContinuing(audio) {
    const localAudioBuffer = Float32Array.from(audio);
    this.#callbacks.onSpeechContinuing(localAudioBuffer);
    
    if (this.#isSttRunning || !this.#partialUpdates) {
      return;
    }

    const currentTimeMs = Date.now();
    const timeSinceLastSttFinishedMs = currentTimeMs - this.#lastSttFinishedTimeMs;

    if (timeSinceLastSttFinishedMs > 10000) {
      this.#isSttRunning = false;
    }

    if (timeSinceLastSttFinishedMs < STT_MINIMUM_INTERVAL_MS) {
      return;
    }

    this.#isSttRunning = true;
    this.#model?.generate(localAudioBuffer).then((text) => {
      this.#callbacks.onTranscriptionUpdated(text, localAudioBuffer);
      this.#isSttRunning = false;
      this.#lastSttFinishedTimeMs = Date.now();
    }).catch(err => {
      this.#callbacks.onError(err);
      this.#isSttRunning = false;
    });
  }

  destroy() {
    this.stop();
    this.#vad.destroy();
  }
}

export default NodeMicTranscriber;
