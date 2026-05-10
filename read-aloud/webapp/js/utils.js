export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

export function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  }[char]));
}

export function sanitizeBaseUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

export function base64ToBlob(base64, type) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export async function extractProviderError(response, fallback) {
  try {
    const data = await response.clone().json();
    return data.error?.message || data.message || `${fallback} (${response.status})`;
  } catch (error) {
    const text = await response.text().catch(() => "");
    return text || `${fallback} (${response.status})`;
  }
}

export function azureRateValue(rate) {
  return `${Math.round((rate - 1) * 100)}%`;
}

export function azurePitchValue(pitch) {
  return `${Math.round((pitch - 1) * 50)}%`;
}

export function renderTextWithActiveWord(text, start, end) {
  const before = escapeHtml(text.slice(0, start));
  const active = escapeHtml(text.slice(start, end));
  const after = escapeHtml(text.slice(end));
  return `${before}<span class="active-word">${active}</span>${after}`;
}

export function locateWordBoundary(text, index) {
  let start = index;
  let end = index;
  while (start > 0 && /\S/.test(text[start - 1])) start -= 1;
  while (end < text.length && /\S/.test(text[end])) end += 1;
  return [start, end];
}
