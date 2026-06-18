// AudioWorklet processor for AUGUST's hands-free voice (Deepgram STT).
//
// Runs on the audio render thread. Each quantum it receives the mic's Float32
// samples in [-1, 1], converts them to 16-bit little-endian PCM (Deepgram
// `encoding=linear16`), and transfers the raw bytes to the main thread, which
// forwards them as a binary WebSocket frame. Kept deliberately minimal — a pure
// format converter; level metering + framing live on the main thread.
//
// Served as a static module from /public so audioWorklet.addModule('/dg-pcm-worklet.js')
// can load it. Plain JS (AudioWorkletGlobalScope) — not bundled, no imports.
//
// Notes:
//  - The render quantum is 128 frames today but the spec allows it to change, so
//    we always use channel.length, never a hardcoded size.
//  - Mono only: we read the first input channel. getUserMedia is requested with
//    channelCount:1, and Deepgram is told channels=1.
//  - Int16Array is little-endian on every current browser, so the buffer is
//    already linear16-LE with no byte-swapping.
class DGPcmWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0]; // first (mono) channel
    if (!channel || channel.length === 0) {
      return true; // keep the node alive across silent / gap quanta
    }

    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      let s = channel[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; // [-1,1] → [-32768,32767]
    }

    // Zero-copy hand-off of the underlying buffer to the main thread.
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true; // returning true keeps process() being called
  }
}

registerProcessor("dg-pcm-worklet", DGPcmWorklet);
