import { useCallback, useEffect, useRef, useState } from 'react';

interface VoiceRecorderState {
  isRecording: boolean;
  audioLevel: number;
  analyser: AnalyserNode | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  error: string | null;
}

function pickMime(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

export function useVoiceRecorder(): VoiceRecorderState {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== 'closed') void ctxRef.current.close();
    ctxRef.current = null;
    recorderRef.current = null;
    setAnalyser(null);
    setAudioLevel(0);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.7;
      src.connect(an);
      setAnalyser(an);

      const data = new Uint8Array(new ArrayBuffer(an.frequencyBinCount));
      const tick = () => {
        an.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setAudioLevel(sum / data.length / 255);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      const mimeType = pickMime();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start();
      recorderRef.current = rec;
      setIsRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      cleanup();
      setIsRecording(false);
      throw e;
    }
  }, [cleanup]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    const rec = recorderRef.current;
    if (!rec) return null;
    return new Promise<Blob | null>((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        cleanup();
        setIsRecording(false);
        resolve(blob.size > 0 ? blob : null);
      };
      try {
        rec.stop();
      } catch {
        cleanup();
        setIsRecording(false);
        resolve(null);
      }
    });
  }, [cleanup]);

  return { isRecording, audioLevel, analyser, startRecording, stopRecording, error };
}
