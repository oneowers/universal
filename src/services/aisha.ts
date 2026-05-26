// Aisha Speech APIs (STT v1 + TTS v1). Proxied through /aisha in dev to bypass CORS.

const AISHA_API_KEY =
  (import.meta.env.VITE_AISHA_API_KEY as string | undefined) ??
  'adbaRinZ.KeNYiwx1bCZu3rj2yfdSCPHB5yeGZQlS';

const BASE = '/aisha';

export interface SttResult {
  id: number;
  transcript: string;
  duration: number;
}

export async function transcribeAudio(audio: Blob, language = 'uz'): Promise<SttResult> {
  // Aisha sometimes returns 402 with error_key="transaction_failed" — a transient
  // wallet-charging error. Their own message says "please try again", so we retry once.
  let attempt = 0;
  let lastError: Error | null = null;
  while (attempt < 2) {
    const form = new FormData();
    const file = new File([audio], 'recording.wav', { type: 'audio/wav' });
    form.append('audio', file);
    form.append('language', language);
    form.append('has_diarization', 'false');

    const res = await fetch(`${BASE}/api/v1/stt/post/`, {
      method: 'POST',
      headers: { 'X-Api-Key': AISHA_API_KEY },
      body: form,
    });

    if (res.ok) {
      return (await res.json()) as SttResult;
    }

    // Inspect the body once to decide retry vs raise.
    const cloned = res.clone();
    let body: { detail?: string; error_key?: string } = {};
    try {
      body = await cloned.json();
    } catch {
      /* ignore */
    }

    const isTransient =
      res.status === 402 && body.error_key === 'transaction_failed';

    if (isTransient && attempt === 0) {
      attempt++;
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }

    lastError = new Error(await prettyError('STT', res, body));
    break;
  }
  throw lastError ?? new Error('STT — noma‘lum xato');
}

async function prettyError(
  service: string,
  res: Response,
  body?: { detail?: string; error_key?: string; message?: string; error?: { message?: string } }
): Promise<string> {
  if (!body) {
    try {
      body = await res.json();
    } catch {
      body = {};
    }
  }
  const errorKey = body?.error_key ?? '';

  // Map well-known Aisha error codes to clear Uzbek messages.
  if (errorKey === 'transaction_failed')
    return `${service} — to‘lov tizimi javob bermadi, qayta urinib ko‘ring`;
  if (errorKey === 'insufficient_balance' || res.status === 402)
    return `${service} — balans tugagan`;
  if (res.status === 429) return `${service} — limit tugadi, biroz kuting`;
  if (res.status === 401 || res.status === 403)
    return `${service} — kalit qabul qilinmadi`;
  if (res.status === 503) return `${service} — servis vaqtincha ishlamayapti`;

  const detail = body?.detail || body?.error?.message || body?.message || '';
  if (typeof detail === 'string' && detail) {
    const short = detail.length > 140 ? detail.slice(0, 140) + '…' : detail;
    return `${service} ${res.status} — ${short}`;
  }
  return `${service} ${res.status} ${res.statusText}`;
}

export interface TtsResult {
  audioUrl: string;
}

export async function synthesizeSpeech(
  text: string,
  opts: { mood?: 'Neutral' | 'Cheerful' | 'Happy' | 'Sad'; speed?: number } = {}
): Promise<TtsResult> {
  const form = new FormData();
  form.append('transcript', text.slice(0, 990));
  form.append('language', 'uz');
  form.append('model', 'Gulnoza');
  form.append('mood', opts.mood ?? 'Neutral');
  form.append('speed', String(opts.speed ?? 1.0));

  const res = await fetch(`${BASE}/api/v1/tts/post/`, {
    method: 'POST',
    headers: { 'X-Api-Key': AISHA_API_KEY },
    body: form,
  });

  if (!res.ok) {
    // Same transient retry policy as STT.
    const cloned = res.clone();
    let body: { detail?: string; error_key?: string } = {};
    try {
      body = await cloned.json();
    } catch {
      /* ignore */
    }
    if (res.status === 402 && body.error_key === 'transaction_failed') {
      await new Promise((r) => setTimeout(r, 800));
      const retry = await fetch(`${BASE}/api/v1/tts/post/`, {
        method: 'POST',
        headers: { 'X-Api-Key': AISHA_API_KEY },
        body: form,
      });
      if (retry.ok) {
        const retryData = (await retry.json()) as { audio_path?: string };
        if (!retryData.audio_path) throw new Error('TTS returned no audio_path');
        const audioUrl = retryData.audio_path.startsWith('http')
          ? retryData.audio_path
          : `${BASE}${retryData.audio_path}`;
        return { audioUrl };
      }
      throw new Error(await prettyError('TTS', retry));
    }
    throw new Error(await prettyError('TTS', res, body));
  }
  const data = (await res.json()) as { audio_path?: string };
  if (!data.audio_path) throw new Error('TTS returned no audio_path');

  // Route audio through the dev proxy so it's same-origin (lets the analyser read frequency data without CORS headers).
  const audioUrl = data.audio_path.startsWith('http')
    ? data.audio_path
    : `${BASE}${data.audio_path}`;
  return { audioUrl };
}
