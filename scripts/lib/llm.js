// 오프라인 스크립트용 LLM 호출 — 출처(회사)를 바꿔 끼울 수 있게 한 곳에 모은다.
//   gemini: Google Gemini (GEMINI_API_KEY) / claude: Anthropic Claude (ANTHROPIC_API_KEY)
//   스크립트에서 --provider claude --model claude-haiku-5-5 처럼 고른다.
//   ⚠️ claude 출처는 2026-10-23 키 없이 작성 — 2026-11-01 첫 실행 때 소량으로 확인할 것
// 모든 호출은 **JSON 스키마로 답을 강제**하고, 토큰 사용량을 함께 돌려준다(비용 측정용).
// 키 값은 로그에 남기지 않는다.

const PROVIDERS = {
  gemini: {
    enabled: () => !!process.env.GEMINI_API_KEY,
    async json({ model, system, prompt, schema, temperature = 0.2 }) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const body = {
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
      };
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        // 한도·일시 오류는 기다렸다가 다시(최대 5번)
        if ((res.status === 429 || res.status >= 500) && attempt < 5) {
          await new Promise((r) => setTimeout(r, 2000 * attempt * attempt));
          continue;
        }
        if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${j.error?.message ?? ''}`.slice(0, 300));
        const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
        const u = j.usageMetadata ?? {};
        return {
          data: JSON.parse(text),
          usage: { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) },
        };
      }
    },
  },
  // Claude: JSON 을 확실히 받으려고 '도구 하나를 반드시 쓰게' 한다(tool_choice). 도구 입력 스키마 = 원하는 JSON 스키마
  claude: {
    enabled: () => !!process.env.ANTHROPIC_API_KEY,
    async json({ model, system, prompt, schema, temperature = 0.2, maxTokens = 16000 }) {
      const body = {
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ name: 'answer', description: '분석·생성 결과를 정해진 형식으로 돌려준다', input_schema: schema }],
        tool_choice: { type: 'tool', name: 'answer' },
      };
      for (let attempt = 1; ; attempt++) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        // 한도(429)·과부하(529)·일시 오류는 기다렸다가 다시(최대 5번)
        if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 5) {
          await new Promise((r) => setTimeout(r, 2000 * attempt * attempt));
          continue;
        }
        if (!res.ok) throw new Error(`claude HTTP ${res.status}: ${j.error?.message ?? ''}`.slice(0, 300));
        const block = (j.content ?? []).find((c) => c.type === 'tool_use');
        if (!block) throw new Error(`claude: 도구 응답 없음 (stop_reason=${j.stop_reason})`);
        const u = j.usage ?? {};
        return { data: block.input, usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0 } };
      }
    },
  },
};

function pickProvider(name) {
  const p = PROVIDERS[name ?? 'gemini'];
  if (!p || !p.enabled()) throw new Error(`LLM 출처 '${name}' 를 쓸 수 없다(키 없음)`);
  return p;
}

module.exports = { pickProvider };
