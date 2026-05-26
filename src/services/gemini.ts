// Gemini chat. Proxied through /gemini in dev to bypass CORS.

const GEMINI_API_KEY =
  (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ??
  'AIzaSyCu-QVTuWlGG2I-SHvaGnj921SQ2Rnu7k8';

const MODEL = 'gemini-2.0-flash';

const SYSTEM_INSTRUCTION = `Sen Navoiy ismli ovozli AI yordamchisan. Foydalanuvchi o'zbek tilida gapiradi va sen ham faqat o'zbek tilida javob berasan.

Qoidalar:
- Faqat sof o'zbek tilida javob ber. Boshqa tilda javob bermaslik.
- Javoblaring ovozga aylantiriladi, shuning uchun matnni qisqa va ravon qil — 1 dan 3 jumlagacha.
- Markdown belgilarini ishlatmaslik (*, _, #, list belgilari yo'q). Faqat oddiy matn, nuqta va vergul.
- Iliq, do'stona ohangda gapir. Ortiqcha rasmiyatchilik yo'q.
- Agar foydalanuvchi savol bersa, aniq javob ber. Agar suhbatlashayotgan bo'lsa, qisqa va jonli javob qaytar.
- Kerak bo'lsa raqamlarni so'z bilan yoz (123 emas "bir yuz yigirma uch").`;

export interface GeminiMessage {
  role: 'user' | 'assistant';
  text: string;
}

export async function askGemini(history: GeminiMessage[]): Promise<string> {
  const contents = history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));

  const url = `/gemini/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 256,
        topP: 0.9,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch {
      // fallthrough
    }
    const short = detail.length > 140 ? detail.slice(0, 140) + '…' : detail;
    if (res.status === 429) throw new Error('Gemini — kvota tugadi, keyinroq urinib ko‘ring');
    if (res.status === 401 || res.status === 403) throw new Error('Gemini — kalit qabul qilinmadi');
    throw new Error(`Gemini ${res.status} — ${short || res.statusText}`);
  }
  type GeminiResponse = {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Gemini returned no text');
  return text;
}
