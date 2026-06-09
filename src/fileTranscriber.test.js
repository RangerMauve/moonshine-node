import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { transcribeFile, parseWav } from "./fileTranscriber.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

const WAV_PATH = join(import.meta.dirname, "..", "helloworld.wav");

describe("fileTranscriber", () => {
  it("should parse WAV file metadata", () => {
    assert.ok(existsSync(WAV_PATH), "helloworld.wav should exist");

    const { samples, sampleRate } = parseWav(WAV_PATH);
    assert.ok(samples.length > 0, "Should have audio samples");
    assert.equal(sampleRate, 16000, "Sample rate should be 16000 Hz");
  });

  it("should transcribe 'hello world' from helloworld.wav", async () => {
    const text = await transcribeFile(WAV_PATH, "model/tiny", false);

    assert.ok(
      typeof text === "string" && text.length > 0,
      `Transcription should be a non-empty string, got: ${text}`
    );

    const lower = text.toLowerCase().trim().replace(/[.,!?]/g, "");
    assert.ok(
      lower.includes("hello") && lower.includes("world"),
      `Transcription should contain "hello" and "world". Got: "${text}"`
    );
  });
});
