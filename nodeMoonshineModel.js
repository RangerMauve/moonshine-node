/**
 * Node.js-compatible Moonshine Model
 *
 * Uses onnxruntime-node instead of onnxruntime-web for server-side inference.
 */

import * as ort from "onnxruntime-node";
import llamaTokenizer from "llama-tokenizer-js";

function argMax(array) {
  return [].map
    .call(array, (x, i) => [x, i])
    .reduce((r, a) => (a[0] > r[0] ? a : r))[1];
}

const MOONSHINE_BASE_URL = "https://download.moonshine.ai";

/**
 * MoonshineModel for Node.js environment
 */
export class NodeMoonshineModel {
  #modelURL;
  #precision;
  #model;
  #shape;
  #decoderStartTokenID = 1;
  #eosTokenID = 2;
  #lastLatency;
  #isModelLoading = false;
  #loadPromise;
  #verbose = false;

  /**
   * @param {string} inputModelURL - Model URL (e.g., 'model/tiny' or 'model/base')
   * @param {string} [precision='quantized'] - Model precision
   * @param {boolean} [verbose=false] - Enable verbose logging
   */
  constructor(inputModelURL, precision = "quantized", verbose = false) {
    let modelURL = inputModelURL;
    if (modelURL === "model/tiny") {
      modelURL = "model/tiny-en";
    } else if (modelURL === "model/base") {
      modelURL = "model/base-en";
    }
    this.#modelURL = `${MOONSHINE_BASE_URL}/${modelURL}`;
    this.#precision = precision;
    this.#verbose = verbose;
    this.#model = {
      encoder: undefined,
      decoder: undefined,
    };

    if (this.#modelURL.includes("tiny")) {
      this.#shape = {
        numLayers: 6,
        numKVHeads: 8,
        headDim: 36,
      };
    } else if (this.#modelURL.includes("base")) {
      this.#shape = {
        numLayers: 8,
        numKVHeads: 8,
        headDim: 52,
      };
    }

    if (this.#verbose)
      console.log(`[NodeMoonshineModel] Created with modelURL = ${modelURL}`);
  }

  /**
   * Load the model weights from URL
   * @returns {Promise<void>}
   */
  async loadModel() {
    if (!this.#loadPromise) {
      this.#loadPromise = this.#load();
    }
    return this.#loadPromise;
  }

  async #load() {
    if (!this.#isModelLoading && !this.isLoaded()) {
      this.#isModelLoading = true;
      if (this.#verbose) console.log("[NodeMoonshineModel] Loading model...");

      try {
        this.#model.encoder = await this.#loadModel(
          `${this.#modelURL}/${this.#precision}/encoder_model.ort`
        );
        this.#model.decoder = await this.#loadModel(
          `${this.#modelURL}/${this.#precision}/decoder_model_merged.ort`
        );
        this.#isModelLoading = false;
        if (this.#verbose)
          console.log("[NodeMoonshineModel] Model loaded successfully");
      } catch (error) {
        this.#isModelLoading = false;
        throw error;
      }
    }
  }

  async #loadModel(modelURL) {
    const response = await fetch(modelURL);
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const sessionOptions = {
      executionProviders: ["cpu"],
    };

    return await ort.InferenceSession.create(arrayBuffer, sessionOptions);
  }

  /**
   * @returns {boolean}
   */
  isLoading() {
    return this.#isModelLoading;
  }

  /**
   * @returns {boolean}
   */
  isLoaded() {
    return (
      this.#model.encoder !== undefined && this.#model.decoder !== undefined
    );
  }

  /**
   * @returns {number}
   */
  getLatency() {
    return this.#lastLatency;
  }

  /**
   * Generate transcription from audio
   * @param {Float32Array} audio - Audio samples
   * @returns {Promise<string>}
   */
  async generate(audio) {
    if (this.#verbose)
      console.log(
        `[NodeMoonshineModel.generate] Processing ${audio.length} samples (${(audio.length / 16000).toFixed(2)}s)`
      );

    if (this.isLoaded()) {
      const t0 = performance.now();
      const maxLen = Math.trunc((audio.length / 16000) * 14);
      if (this.#verbose)
        console.log(`[NodeMoonshineModel.generate] maxLen: ${maxLen}`);

      var encoderInput = {
        input_values: new ort.Tensor("float32", audio, [1, audio.length]),
      };

      var encoderAttentionMask = undefined;
      if (this.#model.encoder.inputNames.includes("attention_mask")) {
        var maskData = new BigInt64Array(audio.length);
        maskData.fill(BigInt(1));
        encoderAttentionMask = new ort.Tensor("int64", maskData, [
          1,
          audio.length,
        ]);
        Object.assign(encoderInput, {
          attention_mask: encoderAttentionMask,
        });
      }

      if (this.#verbose)
        console.log(`[NodeMoonshineModel.generate] Running encoder...`);
      const encoderOutput = await this.#model.encoder.run(encoderInput);
      if (this.#verbose)
        console.log(
          `[NodeMoonshineModel.generate] Encoder output keys:`,
          Object.keys(encoderOutput)
        );

      var pastKeyValues = Object.fromEntries(
        Array.from({ length: this.#shape.numLayers }, (_, i) =>
          ["decoder", "encoder"].flatMap((a) =>
            ["key", "value"].map((b) => [
              `past_key_values.${i}.${a}.${b}`,
              new ort.Tensor(
                "float32",
                [],
                [0, this.#shape.numKVHeads, 1, this.#shape.headDim]
              ),
            ])
          )
        ).flat()
      );

      var tokens = [this.#decoderStartTokenID];
      var inputIDs = [tokens];

      if (this.#verbose)
        console.log(`[NodeMoonshineModel.generate] Starting decoder loop...`);
      for (let i = 0; i < maxLen; i++) {
        var decoderInput = {
          input_ids: new ort.Tensor("int64", inputIDs, [1, inputIDs.length]),
          encoder_hidden_states: encoderOutput.last_hidden_state,
          use_cache_branch: new ort.Tensor("bool", [i > 0]),
        };

        if (encoderAttentionMask) {
          Object.assign(decoderInput, {
            encoder_attention_mask: encoderAttentionMask,
          });
        }

        Object.assign(decoderInput, pastKeyValues);
        var decoderOutput = await this.#model.decoder.run(decoderInput);

        var logits = await decoderOutput.logits.getData();
        var nextToken = argMax(logits);
        tokens.push(nextToken);

        if (nextToken == this.#eosTokenID) {
          if (this.#verbose)
            console.log(
              `[NodeMoonshineModel.generate] EOS token reached at iteration ${i}`
            );
          break;
        }
        inputIDs = [[nextToken]];

        const presentKeyValues = Object.entries(decoderOutput)
          .filter(([key, _]) => key.includes("present"))
          .map(([_, value]) => value);

        Object.keys(pastKeyValues).forEach((k, index) => {
          const v = presentKeyValues[index];
          if (!(i > 0) || k.includes("decoder")) {
            pastKeyValues[k] = v;
          }
        });
      }

      this.#lastLatency = performance.now() - t0;
      const result = llamaTokenizer.decode(tokens.slice(0, -1));
      if (this.#verbose)
        console.log(
          `[NodeMoonshineModel.generate] Tokens: ${tokens.join(" ")}, Result: "${result}"`
        );
      return result;
    } else {
      console.warn("[NodeMoonshineModel.generate] Model not loaded yet");
      return undefined;
    }
  }
}

export default NodeMoonshineModel;
