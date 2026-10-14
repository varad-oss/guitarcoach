"use client";

/**
 * Microphone input → capture worklet → analysis worker. Audio never leaves the
 * browser. Handles permission errors, missing devices, unplugging and cleanup.
 */

import { getAudioContext, resumeAudio } from "./engine";
import type { AnalysisMode, FromWorker } from "./protocol";

export type MicStatus = "off" | "starting" | "on" | "denied" | "no-device" | "busy" | "unsupported" | "error";

export interface MicError {
  status: MicStatus;
  message: string;
}

export function describeMicError(e: unknown): MicError {
  const name = (e as { name?: string })?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return { status: "denied", message: "Microphone access is blocked. Allow it in your browser's site settings, then try again." };
    case "NotFoundError":
    case "OverconstrainedError":
      return { status: "no-device", message: "No microphone was found. Plug one in or pick another input in Settings." };
    case "NotReadableError":
    case "AbortError":
      return { status: "busy", message: "The microphone is in use by another app or couldn't be started." };
    default:
      return { status: "error", message: "The microphone couldn't be started." };
  }
}

export function micSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof Worker !== "undefined"
  );
}

export interface MicHandlers {
  onMessage: (m: FromWorker) => void;
  onEnded?: (reason: string) => void;
}

export class MicInput {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private worker: Worker | null = null;
  private deviceListener: (() => void) | null = null;
  /** Input latency reported by the browser, seconds (0 if unknown). */
  inputLatency = 0;
  deviceLabel = "";

  constructor(private handlers: MicHandlers) {}

  async start(opts: { deviceId?: string; mode: AnalysisMode; a4: number }): Promise<void> {
    if (!micSupported()) throw Object.assign(new Error("unsupported"), { name: "Unsupported" });
    const ctx = await resumeAudio();
    const constraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    };
    if (opts.deviceId) constraints.deviceId = { exact: opts.deviceId };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    } catch (e) {
      if (opts.deviceId && (e as { name?: string }).name === "OverconstrainedError") {
        // The saved device is gone; fall back to the default input.
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { ...constraints, deviceId: undefined } });
      } else throw e;
    }
    const track = this.stream.getAudioTracks()[0];
    this.deviceLabel = track?.label ?? "";
    const settings = track?.getSettings?.() as MediaTrackSettings & { latency?: number };
    this.inputLatency = typeof settings?.latency === "number" ? settings.latency : 0;
    track?.addEventListener("ended", () => this.handlers.onEnded?.("The microphone was disconnected."));

    await ctx.audioWorklet.addModule("/worklets/capture-processor.js");
    this.source = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, "gc-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(ctx.destination);

    this.worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.handlers.onMessage(e.data);
    const channel = new MessageChannel();
    this.worker.postMessage({ type: "init", sampleRate: ctx.sampleRate, mode: opts.mode, a4: opts.a4, port: channel.port2 }, [channel.port2]);
    this.node.port.postMessage({ type: "port", port: channel.port1 }, [channel.port1]);

    this.deviceListener = () => {
      if (this.stream && this.stream.getAudioTracks().every((t) => t.readyState === "ended")) {
        this.handlers.onEnded?.("The microphone was disconnected.");
      }
    };
    navigator.mediaDevices.addEventListener?.("devicechange", this.deviceListener);
  }

  setMode(mode: AnalysisMode): void {
    this.worker?.postMessage({ type: "mode", mode });
  }

  setA4(a4: number): void {
    this.worker?.postMessage({ type: "a4", a4 });
  }

  stop(): void {
    if (this.deviceListener) navigator.mediaDevices.removeEventListener?.("devicechange", this.deviceListener);
    this.deviceListener = null;
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.node?.port.close();
    this.worker?.terminate();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.node = null;
    this.sink = null;
    this.worker = null;
  }

  get audioContext(): AudioContext {
    return getAudioContext();
  }
}

export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput");
}
