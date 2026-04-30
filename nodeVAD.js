/**
 * Node.js VAD implementation based on vad-moonshine FrameProcessor
 * Uses TEN VAD model for voice activity detection
 */

import loadTENVAD from '@gooney-001/ten-vad-lib';

export const defaultVADOptions = {
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,  // 0.15 less than positive
  redemptionFrames: 8,            // Frames to wait before confirming speech end
  frameSize: 256,                 // TEN VAD frame size
  preSpeechPadFrames: 32,         // Frames to keep before speech start (~512ms at 16kHz)
  minSpeechFrames: 20,            // Minimum frames to consider valid speech
};

/**
 * VAD processor using TEN VAD model
 */
export class NodeVAD {
  #vadModule;
  #vadHandle;
  #frameSize;
  #positiveThreshold;
  #negativeThreshold;
  #redemptionFrames;
  #preSpeechPadFrames;
  #minSpeechFrames;
  #verbose;

  #speaking;
  #audioBuffer;  // Array of { frame: Float32Array, isSpeech: boolean }
  #redemptionCounter;
  #speechFrameCount;
  #active;

  #callbacks;

  constructor(options = {}) {
    this.#frameSize = options.frameSize || defaultVADOptions.frameSize;
    this.#positiveThreshold = options.positiveSpeechThreshold || defaultVADOptions.positiveSpeechThreshold;
    this.#negativeThreshold = options.negativeSpeechThreshold || defaultVADOptions.negativeSpeechThreshold;
    this.#redemptionFrames = options.redemptionFrames || defaultVADOptions.redemptionFrames;
    this.#preSpeechPadFrames = options.preSpeechPadFrames || defaultVADOptions.preSpeechPadFrames;
    this.#minSpeechFrames = options.minSpeechFrames || defaultVADOptions.minSpeechFrames;
    this.#verbose = options.verbose || false;

    this.#callbacks = {
      onVoiceStart: options.onVoiceStart || (() => {}),
      onVoiceEnd: options.onVoiceEnd || (() => {}),
      onVoiceContinuing: options.onVoiceContinuing || (() => {}),
    };

    this.reset();
  }

  reset() {
    this.#speaking = false;
    this.#audioBuffer = [];
    this.#redemptionCounter = 0;
    this.#speechFrameCount = 0;
    this.#active = true;
  }

  async load() {
    this.#vadModule = await loadTENVAD();

    const vadHandlePtr = this.#vadModule._malloc(4);
    const result = this.#vadModule._ten_vad_create(
      vadHandlePtr,
      this.#frameSize,
      0.5  // Internal threshold (we do our own thresholding)
    );

    if (result !== 0) {
      throw new Error(`Failed to create VAD instance: ${result}`);
    }

    this.#vadHandle = this.#vadModule.getValue(vadHandlePtr, 'i32');
    this.#vadModule._free(vadHandlePtr);
  }

  isLoaded() {
    return !!this.#vadHandle;
  }

  /**
   * Process audio data
   * @param {Float32Array} audio - Audio samples normalized to [-1, 1]
   */
  processAudio(audio) {
    if (!this.#vadHandle || !this.#active) return;

    let offset = 0;
    while (offset + this.#frameSize <= audio.length) {
      const frame = audio.slice(offset, offset + this.#frameSize);
      this.#processFrame(frame);
      offset += this.#frameSize;
    }
  }

  #processFrame(frame) {
    const probability = this.#getSpeechProbability(frame);
    const isSpeech = probability >= this.#positiveThreshold;

    // Add frame to buffer
    this.#audioBuffer.push({ frame, isSpeech });

    if (isSpeech) {
      this.#speechFrameCount++;
      this.#redemptionCounter = 0;

      // Speech start detected
      if (!this.#speaking) {
        this.#speaking = true;
        this.#callbacks.onVoiceStart(this.#getSpeechAudio());
      }

      // Speech continuing
      if (this.#speechFrameCount >= this.#minSpeechFrames) {
        this.#callbacks.onVoiceContinuing(this.#getSpeechAudio());
      }
    }

    // Check for speech end
    if (probability < this.#negativeThreshold && this.#speaking) {
      this.#redemptionCounter++;

      if (this.#redemptionCounter >= this.#redemptionFrames) {
        this.#endSpeech();
      }
    }

    // Trim buffer when not speaking to keep only preSpeechPadFrames
    if (!this.#speaking) {
      while (this.#audioBuffer.length > this.#preSpeechPadFrames) {
        this.#audioBuffer.shift();
      }
      this.#speechFrameCount = 0;
    }
  }

  #endSpeech() {
    const audioBuffer = this.#audioBuffer;
    this.#audioBuffer = [];
    this.#redemptionCounter = 0;
    this.#speechFrameCount = 0;
    this.#speaking = false;

    // Count actual speech frames
    const speechFrameCount = audioBuffer.reduce((acc, item) => {
      return item.isSpeech ? acc + 1 : acc;
    }, 0);

    if (speechFrameCount >= this.#minSpeechFrames) {
      const audio = this.#concatArrays(audioBuffer.map(item => item.frame));
      this.#callbacks.onVoiceEnd(audio);
    }
    // Otherwise it's a misfire, silently ignore
  }

  #getSpeechAudio() {
    const speechFrames = this.#audioBuffer.map(item => item.frame);
    return this.#concatArrays(speechFrames);
  }

  #concatArrays(arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  #getSpeechProbability(frame) {
    const int16Frame = new Int16Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      int16Frame[i] = Math.round(frame[i] * 32767);
    }

    const audioPtr = this.#vadModule._malloc(this.#frameSize * 2);
    const probPtr = this.#vadModule._malloc(4);
    const flagPtr = this.#vadModule._malloc(4);

    this.#vadModule.HEAP16.set(int16Frame, audioPtr >> 1);

    const result = this.#vadModule._ten_vad_process(
      this.#vadHandle,
      audioPtr,
      this.#frameSize,
      probPtr,
      flagPtr
    );

    let probability = 0;
    if (result === 0) {
      probability = this.#vadModule.getValue(probPtr, 'float');
    }

    this.#vadModule._free(audioPtr);
    this.#vadModule._free(probPtr);
    this.#vadModule._free(flagPtr);

    return probability;
  }

  destroy() {
    if (this.#vadHandle) {
      const vadHandlePtr = this.#vadModule._malloc(4);
      this.#vadModule.setValue(vadHandlePtr, this.#vadHandle, 'i32');
      this.#vadModule._ten_vad_destroy(vadHandlePtr);
      this.#vadModule._free(vadHandlePtr);
    }
  }
}

export default NodeVAD;
