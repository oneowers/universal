import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Show, SignInButton, UserButton } from '@clerk/react';
import { VoiceOrb, type OrbMode } from './components/VoiceOrb';
import { useVoiceRecorder } from './hooks/useVoiceRecorder';
import { transcribeAudio, synthesizeSpeech } from './services/aisha';
import { askGemini, type GeminiMessage } from './services/gemini';
import { blobToWav } from './utils/audio';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  audioUrl?: string;
  duration?: number;
};

const STATUS_COPY: Record<OrbMode, { eyebrow: string; headline: string }> = {
  idle:         { eyebrow: '⌖ Tayyor',          headline: 'Sukunatda.\nGapirishga ishora bering.' },
  recording:    { eyebrow: '● Eshityapman',     headline: 'Quloq solyapman.' },
  transcribing: { eyebrow: '◐ Aniqlanmoqda',    headline: 'So‘zlaringizni\no‘qiyapman.' },
  thinking:     { eyebrow: '✶ Fikrlanmoqda',    headline: 'Bir lahza —\nfikrlayapman.' },
  speaking:     { eyebrow: '◉ Javob beryapman', headline: 'Eshiting.' },
  error:        { eyebrow: '⚠ Xatolik',          headline: 'Birikma\nuzildi.' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function useClock(): string {
  const [time, setTime] = useState(() => formatNow());
  useEffect(() => {
    const id = setInterval(() => setTime(formatNow()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function formatNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export default function App() {
  const [mode, setMode] = useState<OrbMode>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [lastResponse, setLastResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);

  const { isRecording, audioLevel, analyser, startRecording, stopRecording } = useVoiceRecorder();
  const clock = useClock();

  // Lazy-init playback analyser on first play. We can't bind a MediaElementAudioSourceNode
  // twice to the same <audio>, so we create it on first user interaction.
  const ensurePlaybackGraph = useCallback(() => {
    if (playbackAnalyserRef.current) return playbackAnalyserRef.current;
    const el = audioRef.current;
    if (!el) return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const source = ctx.createMediaElementSource(el);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.6;
    source.connect(an);
    an.connect(ctx.destination);
    playbackCtxRef.current = ctx;
    playbackAnalyserRef.current = an;
    return an;
  }, []);

  const playAudioUrl = useCallback(
    async (url: string) => {
      const el = audioRef.current;
      if (!el) return;
      ensurePlaybackGraph();
      el.src = url;
      if (playbackCtxRef.current?.state === 'suspended') {
        await playbackCtxRef.current.resume();
      }
      try {
        await el.play();
      } catch (e) {
        console.warn('Autoplay blocked:', e);
      }
    },
    [ensurePlaybackGraph]
  );

  const runPipeline = useCallback(
    async (audioBlob: Blob) => {
      const startedAt = performance.now();
      setError(null);
      try {
        // 1) Convert to WAV for STT
        setMode('transcribing');
        const wav = await blobToWav(audioBlob);

        // 2) STT (Aisha)
        const stt = await transcribeAudio(wav, 'uz');
        const transcript = stt.transcript?.trim();
        if (!transcript) throw new Error('Bo‘sh transkript');

        setLiveTranscript(transcript);
        const userMsg: Message = {
          id: `u-${Date.now()}`,
          role: 'user',
          text: transcript,
          ts: Date.now(),
        };
        setMessages((prev) => [...prev, userMsg]);

        // 3) Gemini
        setMode('thinking');
        const history: GeminiMessage[] = [...messages, userMsg].map((m) => ({
          role: m.role,
          text: m.text,
        }));
        const reply = await askGemini(history);
        setLastResponse(reply);

        // 4) TTS (Aisha → Gulnoza)
        setMode('speaking');
        const tts = await synthesizeSpeech(reply, { mood: 'Cheerful', speed: 1.0 });

        const aiMsg: Message = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: reply,
          ts: Date.now(),
          audioUrl: tts.audioUrl,
        };
        setMessages((prev) => [...prev, aiMsg]);

        await playAudioUrl(tts.audioUrl);
        setLatencyMs(Math.round(performance.now() - startedAt));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Pipeline error:', e);
        setError(msg);
        setMode('error');
        setTimeout(() => setMode('idle'), 2400);
      }
    },
    [messages, playAudioUrl]
  );

  const handleRecord = useCallback(async () => {
    if (mode === 'idle' || mode === 'error') {
      try {
        setLiveTranscript('');
        setLastResponse('');
        setError(null);
        await startRecording();
        setMode('recording');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Mikrofon: ${msg}`);
        setMode('error');
        setTimeout(() => setMode('idle'), 2400);
      }
    } else if (mode === 'recording') {
      const blob = await stopRecording();
      if (blob) await runPipeline(blob);
      else setMode('idle');
    }
  }, [mode, startRecording, stopRecording, runPipeline]);

  // Audio ended → back to idle
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onEnd = () => setMode('idle');
    const onError = () => setMode('idle');
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onError);
    };
  }, []);

  // Space to toggle recording
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault();
        void handleRecord();
      }
      if (e.code === 'Escape' && mode === 'recording') {
        void stopRecording().then(() => setMode('idle'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleRecord, mode, stopRecording]);

  const replayMessage = useCallback(
    async (m: Message) => {
      if (m.audioUrl) {
        setMode('speaking');
        await playAudioUrl(m.audioUrl);
      }
    },
    [playAudioUrl]
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
    setLiveTranscript('');
    setLastResponse('');
    setLatencyMs(null);
    setError(null);
  }, []);

  const userCount = messages.filter((m) => m.role === 'user').length;
  const recentMessages = useMemo(() => [...messages].reverse(), [messages]);
  const status = STATUS_COPY[mode];
  const isBusy = mode === 'transcribing' || mode === 'thinking' || mode === 'speaking';

  return (
    <div className="shell">
      <audio ref={audioRef} className="audio-out" crossOrigin="anonymous" preload="auto" />

      {/* ─────────── HEADER ─────────── */}
      <header className="shell-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 2 L14.5 9 L22 11.5 L14.5 14 L12 22 L9.5 14 L2 11.5 L9.5 9 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="currentColor" />
            </svg>
          </span>
          <h1 className="brand-name">
            Navo<em>ï</em>y
          </h1>
          <span className="brand-tag">Voice intelligence · uz</span>
        </div>

        <div className="header-center">
          <span>STT</span>
          <span className="dash" />
          <span>Gemini 2.0</span>
          <span className="dash" />
          <span>TTS · Gulnoza</span>
        </div>

        <div className="header-right">
          <span className="clock">{clock}</span>
          <div className="auth-slot">
            <Show when="signed-out">
              <SignInButton>
                <button className="auth-button" type="button">
                  Kirish
                </button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <UserButton />
            </Show>
          </div>
        </div>
      </header>

      {/* ─────────── MAIN ─────────── */}
      <main className="shell-main">
        {/* LEFT RAIL — history */}
        <aside className="rail left">
          <section className="rail-section">
            <div className="rail-label">
              <span>Tarix</span>
              <span className="count">№ {String(userCount).padStart(2, '0')}</span>
            </div>

            {messages.length === 0 ? (
              <p className="history-empty">
                Hech qanday yozuv yo‘q. Birinchi savolingizni mikrofon orqali ayting va Navoiy javob beradi.
              </p>
            ) : (
              <div className="history-list">
                {recentMessages.map((m) => (
                  <div className={`message ${m.role}`} key={m.id}>
                    <div className="msg-meta">
                      <span className="msg-role">
                        {m.role === 'user' ? 'Siz' : 'Navoiy'}
                      </span>
                      <span className="msg-time">{formatTime(m.ts)}</span>
                    </div>
                    <div className="msg-text">{m.text}</div>
                    {m.audioUrl && (
                      <button className="msg-play" type="button" onClick={() => replayMessage(m)}>
                        <svg viewBox="0 0 12 12" fill="currentColor"><polygon points="3,2 10,6 3,10" /></svg>
                        Qayta eshitish
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {messages.length > 0 && (
            <section className="rail-section">
              <button className="aux-button" type="button" onClick={clearHistory}>
                <svg viewBox="0 0 12 12" stroke="currentColor" fill="none" strokeWidth="1.4">
                  <path d="M2 2 L10 10 M10 2 L2 10" strokeLinecap="round" />
                </svg>
                Tarixni tozalash
              </button>
            </section>
          )}
        </aside>

        {/* CENTER — orb stage */}
        <section className="stage">
          <span className="stage-corner tl" />
          <span className="stage-corner tr" />
          <span className="stage-corner bl" />
          <span className="stage-corner br" />

          <div className="stage-numeral">
            <span>seans</span>
            <span style={{ color: 'var(--ink-2)', fontFamily: 'var(--mono)' }}>
              {String(messages.length).padStart(3, '0')}
            </span>
          </div>

          <div className="orb-wrap">
            <VoiceOrb
              mode={mode}
              audioLevel={audioLevel}
              analyser={analyser}
              playbackAnalyser={playbackAnalyserRef.current}
            />
            <div className="orb-status">
              <span className="status-eyebrow">{status.eyebrow}</span>
              <h2 className={`status-headline ${mode === 'thinking' ? 'compact' : ''}`}>
                {status.headline.split('\n').map((line, i, arr) => (
                  <span key={i}>
                    {line}
                    {i < arr.length - 1 && <br />}
                  </span>
                ))}
              </h2>
            </div>
          </div>

          <div className="controls">
            <div className="record-row">
              <button
                type="button"
                className={`record-button ${isRecording ? 'active' : ''}`}
                disabled={isBusy}
                aria-label={isRecording ? 'To‘xtatish' : 'Yozishni boshlash'}
                onClick={handleRecord}
              >
                {isRecording ? (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <rect x="7" y="7" width="10" height="10" rx="1.5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
                    <path d="M5 11 a7 7 0 0 0 14 0" strokeLinecap="round" />
                    <line x1="12" y1="18" x2="12" y2="22" strokeLinecap="round" />
                    <line x1="9" y1="22" x2="15" y2="22" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
            <div className="record-hint">
              <kbd>Space</kbd> — boshlash · to‘xtatish &nbsp;·&nbsp; <kbd>Esc</kbd> — bekor qilish
            </div>
          </div>

          {error && <div className="error-banner">— {error} —</div>}
        </section>

        {/* RIGHT RAIL — live transcript + response */}
        <aside className="rail right">
          <section className="rail-section">
            <div className="rail-label">
              <span>Matn</span>
              <span className="count">stt v1</span>
            </div>
            <div className={`live-transcript ${liveTranscript ? '' : 'empty'}`}>
              {liveTranscript ? (
                <div className="transcript-text">«{liveTranscript}»</div>
              ) : (
                <div className="transcript-placeholder">
                  Tinglashga tayyor
                </div>
              )}
            </div>
          </section>

          <section className="rail-section">
            <div className="rail-label">
              <span>Javob</span>
              <span className="count">gemini 2.0</span>
            </div>
            <div className="response-card">
              {lastResponse ? (
                <div className="response-text">{lastResponse}</div>
              ) : (
                <div className="response-text empty">— hali javob yo‘q —</div>
              )}
            </div>
          </section>

          <section className="rail-section">
            <div className="rail-label">
              <span>Ko‘rsatkichlar</span>
            </div>
            <div className="metric-grid">
              <div className="metric">
                <span className="metric-label">Savollar</span>
                <span className="metric-value accent">
                  {String(userCount).padStart(2, '0')}
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">Javoblar</span>
                <span className="metric-value cool">
                  {String(messages.filter((m) => m.role === 'assistant').length).padStart(2, '0')}
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">Lat. (ms)</span>
                <span className="metric-value">{latencyMs ? latencyMs : '—'}</span>
              </div>
              <div className="metric">
                <span className="metric-label">Til</span>
                <span className="metric-value">o‘z</span>
              </div>
            </div>
          </section>
        </aside>
      </main>

      {/* ─────────── FOOTER ─────────── */}
      <footer className="shell-footer">
        <div className="footer-left">
          <span className="pill">
            <span className={`dot ${mode === 'recording' ? 'live' : mode === 'error' ? 'danger' : ''}`} />
            Aisha STT
          </span>
          <span className="pill">
            <span className={`dot ${mode === 'thinking' ? 'live' : ''}`} />
            Google Gemini
          </span>
          <span className="pill">
            <span className={`dot ${mode === 'speaking' ? 'cool' : ''}`} />
            Aisha TTS · Gulnoza
          </span>
        </div>
        <div className="footer-right">
          <span>Rejim: {mode.toUpperCase()}</span>
          <span style={{ color: 'var(--gold)' }}>Navoiy / 2026</span>
        </div>
      </footer>
    </div>
  );
}
