/**
 * Novel reading typography — curated serif stacks for Advanced / EPUB views.
 */

export const NOVEL_FONTS = [
  { id: "literata", label: "Literata", family: "'Literata', Georgia, serif", sample: "The night was warm and still." },
  { id: "lora", label: "Lora", family: "'Lora', Georgia, serif", sample: "A story begins in silence." },
  { id: "merriweather", label: "Merriweather", family: "'Merriweather', Georgia, serif", sample: "She turned toward the light." },
  { id: "eb-garamond", label: "EB Garamond", family: "'EB Garamond', 'Times New Roman', serif", sample: "Elegant pages, timeless prose." },
  { id: "libre-baskerville", label: "Libre Baskerville", family: "'Libre Baskerville', Georgia, serif", sample: "Classic novel rhythm." },
  { id: "cormorant", label: "Cormorant Garamond", family: "'Cormorant Garamond', Georgia, serif", sample: "Literary and luminous." },
  { id: "source-serif", label: "Source Serif 4", family: "'Source Serif 4', Georgia, serif", sample: "Clear long-form reading." },
  { id: "crimson", label: "Crimson Text", family: "'Crimson Text', Georgia, serif", sample: "Warm, bookish tone." },
];

export const NOVEL_FONT_SIZES = [
  { id: "compact", label: "S", px: 17, lh: 1.72 },
  { id: "comfort", label: "M", px: 19, lh: 1.78 },
  { id: "roomy", label: "L", px: 21, lh: 1.82 },
  { id: "grand", label: "XL", px: 24, lh: 1.88 },
];

const DEFAULT_FONT = "literata";
const DEFAULT_SIZE = "roomy";

export function normalizeNovelFontId(id) {
  return NOVEL_FONTS.some((f) => f.id === id) ? id : DEFAULT_FONT;
}

export function normalizeNovelSizeId(id) {
  return NOVEL_FONT_SIZES.some((s) => s.id === id) ? id : DEFAULT_SIZE;
}

export function getNovelFont(id) {
  return NOVEL_FONTS.find((f) => f.id === normalizeNovelFontId(id)) || NOVEL_FONTS[0];
}

export function getNovelSize(id) {
  return NOVEL_FONT_SIZES.find((s) => s.id === normalizeNovelSizeId(id)) || NOVEL_FONT_SIZES[2];
}

export function applyNovelTypography(root, { fontId, sizeId } = {}) {
  if (!root) return;
  const font = getNovelFont(fontId);
  const size = getNovelSize(sizeId);
  root.style.setProperty("--novel-font", font.family);
  root.style.setProperty("--novel-size", `${size.px}px`);
  root.style.setProperty("--novel-lh", String(size.lh));
  root.dataset.novelFont = font.id;
  root.dataset.novelSize = size.id;
}

function renderFontOptions(selectedId) {
  return NOVEL_FONTS.map(
    (f) =>
      `<option value="${f.id}" ${f.id === selectedId ? "selected" : ""}>${f.label}</option>`
  ).join("");
}

function renderSizeButtons(selectedId) {
  return NOVEL_FONT_SIZES.map(
    (s) =>
      `<button type="button" class="novel-size-btn${s.id === selectedId ? " is-active" : ""}" data-size="${s.id}" title="${s.px}px">${s.label}</button>`
  ).join("");
}

export function ensureNovelTypographyToolbar(host, { fontId, sizeId, onChange } = {}) {
  if (!host) return null;

  const fid = normalizeNovelFontId(fontId);
  const sid = normalizeNovelSizeId(sizeId);

  let wrap = host.querySelector(".novel-typography-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "novel-typography-wrap";
    host.prepend(wrap);

    const toggleWrap = document.createElement("div");
    toggleWrap.className = "novel-typography-toggle-wrap";
    toggleWrap.innerHTML = `<button type="button" class="novel-typography-toggle">Aa Typography</button>`;
    wrap.appendChild(toggleWrap);
  }

  let bar = wrap.querySelector(".novel-typography-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "novel-typography-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Reading typography");
    bar.hidden = true; // Hidden by default to save space
    wrap.appendChild(bar);
    bar.innerHTML = `
      <label class="novel-typography-field">
        <span class="novel-typography-label">Typeface</span>
        <select class="novel-font-select" aria-label="Novel typeface"></select>
      </label>
      <div class="novel-typography-field novel-typography-sizes">
        <span class="novel-typography-label">Size</span>
        <div class="novel-size-group" role="group" aria-label="Text size"></div>
      </div>
      <p class="novel-font-sample" aria-live="polite"></p>
    `;

    const toggleBtn = wrap.querySelector(".novel-typography-toggle");
    toggleBtn?.addEventListener("click", () => {
      bar.hidden = !bar.hidden;
    });

    const select = bar.querySelector(".novel-font-select");
    select?.addEventListener("change", () => {
      const nextFont = select.value;
      applyNovelTypography(host, { fontId: nextFont, sizeId: host.dataset.novelSize || sid });
      updateSample(bar, nextFont);
      onChange?.({ fontId: nextFont, sizeId: host.dataset.novelSize || sid });
    });

    bar.querySelector(".novel-size-group")?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-size]");
      if (!btn) return;
      const nextSize = btn.dataset.size;
      bar.querySelectorAll(".novel-size-btn").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.size === nextSize);
      });
      applyNovelTypography(host, { fontId: host.dataset.novelFont || fid, sizeId: nextSize });
      onChange?.({ fontId: host.dataset.novelFont || fid, sizeId: nextSize });
    });
  }

  const select = bar.querySelector(".novel-font-select");
  if (select) {
    if (select.options.length !== NOVEL_FONTS.length) select.innerHTML = renderFontOptions(fid);
    else select.value = fid;
  }

  const sizeGroup = bar.querySelector(".novel-size-group");
  if (sizeGroup && !sizeGroup.childElementCount) {
    sizeGroup.innerHTML = renderSizeButtons(sid);
  } else if (sizeGroup) {
    sizeGroup.querySelectorAll(".novel-size-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.size === sid);
    });
  }

  applyNovelTypography(host, { fontId: fid, sizeId: sid });
  updateSample(bar, fid);
  return bar;
}

function updateSample(bar, fontId) {
  const sample = bar?.querySelector(".novel-font-sample");
  if (!sample) return;
  const font = getNovelFont(fontId);
  sample.textContent = font.sample;
  sample.style.fontFamily = font.family;
}
