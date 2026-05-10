export const STORAGE_KEY = "read-aloud-webapp:v2";

export const MAX_CHARS_PER_CHUNK = {
  balanced: 550,
  paragraphs: 1800,
  sentences: 240,
};

export const OPENAI_DEFAULT_VOICES = [
  { id: "alloy", name: "OpenAI alloy", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
  { id: "ash", name: "OpenAI ash", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
  { id: "ballad", name: "OpenAI ballad", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
  { id: "coral", name: "OpenAI coral", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
  { id: "echo", name: "OpenAI echo", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
  { id: "fable", name: "OpenAI fable", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
  { id: "nova", name: "OpenAI nova", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
  { id: "onyx", name: "OpenAI onyx", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
  { id: "sage", name: "OpenAI sage", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
  { id: "shimmer", name: "OpenAI shimmer", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
  { id: "verse", name: "OpenAI verse", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
  { id: "marin", name: "OpenAI marin", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
  { id: "cedar", name: "OpenAI cedar", model: "gpt-4o-mini-tts", langs: ["en-US", "zh-CN"] },
];

export const PROVIDER_ORDER = ["native", "googleTranslate", "openai", "google", "amazon", "azure", "ibm"];
