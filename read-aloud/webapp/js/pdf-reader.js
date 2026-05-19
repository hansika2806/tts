/**
 * PDF Book Reader
 * Lazy-loads canvases and progressively extracts text to prevent freezing on huge PDFs.
 */

let pdfjsLib = null;
let lastHighlightedWrapper = null;

async function getPdfJs() {
  if (!pdfjsLib) {
    const module = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs");
    module.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";
    pdfjsLib = module;
  }
  return pdfjsLib;
}

export async function openPdfBook(file, containerEl, onStatus, onChunkReady, onFinished) {
  containerEl.innerHTML = "";
  containerEl.classList.add("pdf-loading");
  lastHighlightedWrapper = null;

  onStatus?.("Loading PDF parser…");
  const lib = await getPdfJs();

  onStatus?.("Parsing PDF document…");
  const buffer = await file.arrayBuffer();
  const pdfDoc = await lib.getDocument({ data: buffer }).promise;

  const SCALE = 1.25;
  const allChunks = [];
  let globalChunkId = 0;

  containerEl.classList.remove("pdf-loading");
  const docTitle = file.name.replace(/\.[^.]+$/, "");
  containerEl.dataset.title = docTitle;

  const page1 = await pdfDoc.getPage(1);
  const vp1 = page1.getViewport({ scale: SCALE });

  const pageWrappers = [];

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const pNum = parseInt(entry.target.dataset.page, 10);
        if (!entry.target.dataset.rendered) {
          entry.target.dataset.rendered = "true";
          renderPageVisuals(pdfDoc, pNum, entry.target, SCALE);
        }
      }
    },
    { root: containerEl, rootMargin: "400px 0px" }
  );

  for (let pNum = 1; pNum <= pdfDoc.numPages; pNum++) {
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page";
    wrapper.dataset.page = String(pNum);
    wrapper.style.width = vp1.width + "px";
    wrapper.style.height = vp1.height + "px";
    wrapper.style.backgroundColor = "#fff";

    const label = document.createElement("div");
    label.className = "pdf-page-label";
    label.textContent = `Page ${pNum}`;
    label.style.zIndex = "10";
    wrapper.appendChild(label);

    containerEl.appendChild(wrapper);
    pageWrappers.push(wrapper);
    io.observe(wrapper);
  }

  setTimeout(async () => {
    for (let pNum = 1; pNum <= pdfDoc.numPages; pNum++) {
      onStatus?.(`Extracting page ${pNum} / ${pdfDoc.numPages}…`);

      try {
        const page = await pdfDoc.getPage(pNum);
        const textContent = await page.getTextContent();
        const items = textContent.items.filter((i) => i.str.trim());

        let currentChunk = "";
        let currentItems = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          currentChunk += (currentChunk ? " " : "") + item.str;
          currentItems.push(i);

          if (/[.?!]$/.test(item.str) || currentChunk.length > 150 || i === items.length - 1) {
            const chunkObj = {
              id: globalChunkId++,
              text: currentChunk.replace(/\s+/g, " ").trim(),
              pageIndex: pNum - 1,
              itemIndices: currentItems,
            };
            allChunks.push(chunkObj);
            onChunkReady?.(chunkObj);

            currentChunk = "";
            currentItems = [];
          }
        }
      } catch (e) {
        console.warn(`Failed to extract text from page ${pNum}`, e);
      }

      if (pNum % 5 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onFinished?.();
  }, 50);

  return { title: docTitle, pageCount: pdfDoc.numPages, pageWrappers };
}

async function renderPageVisuals(pdfDoc, pageNum, wrapper, SCALE) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: SCALE });

    wrapper.style.width = viewport.width + "px";
    wrapper.style.height = viewport.height + "px";

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrapper.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "pdf-text-layer";
    textLayerDiv.style.width = viewport.width + "px";
    textLayerDiv.style.height = viewport.height + "px";
    wrapper.appendChild(textLayerDiv);

    const textContent = await page.getTextContent();
    const items = textContent.items.filter((i) => i.str.trim());

    const fragment = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const span = document.createElement("span");
      span.textContent = item.str;
      const left = item.transform[4] * SCALE;
      const top = viewport.height - item.transform[5] * SCALE;
      const fontSize = item.transform[0] * SCALE;

      span.style.left = left + "px";
      span.style.top = top - fontSize + "px";
      span.style.fontSize = fontSize + "px";
      span.dataset.itemIdx = String(idx);
      fragment.appendChild(span);
    });
    textLayerDiv.appendChild(fragment);

    textLayerDiv.addEventListener("dblclick", (e) => {
      const span = e.target.closest("span[data-item-idx]");
      if (!span) return;
      e.preventDefault();
      window.dispatchEvent(
        new CustomEvent("pdf-start-from", {
          detail: { pageIndex: pageNum - 1, itemIdx: parseInt(span.dataset.itemIdx, 10) },
        })
      );
    });
  } catch (err) {
    console.error(`Render failed for page ${pageNum}`, err);
  }
}

function clearHighlights(wrapper) {
  if (!wrapper) return;
  wrapper.classList.remove("pdf-page-active");
  const layer = wrapper.querySelector(".pdf-text-layer");
  if (!layer) return;
  layer.querySelectorAll(".pdf-highlight").forEach((el) => el.classList.remove("pdf-highlight"));
}

/**
 * Highlights a specific chunk by adding classes to its spans.
 * @param {{ pageIndex: number, itemIndices: number[] } | null} chunk
 * @param {HTMLElement[]} pageWrappers
 * @param {{ smooth?: boolean }} [options]
 */
export function highlightChunk(chunk, pageWrappers, options = {}) {
  const smooth = options.smooth === true;

  if (lastHighlightedWrapper) {
    clearHighlights(lastHighlightedWrapper);
    lastHighlightedWrapper = null;
  }

  if (!chunk) return;

  const wrapper = pageWrappers[chunk.pageIndex];
  if (!wrapper) return;

  wrapper.classList.add("pdf-page-active");
  lastHighlightedWrapper = wrapper;

  const textLayer = wrapper.querySelector(".pdf-text-layer");
  if (textLayer) {
    for (const idx of chunk.itemIndices) {
      const span = textLayer.querySelector(`span[data-item-idx="${idx}"]`);
      if (span) span.classList.add("pdf-highlight");
    }
  }

  wrapper.scrollIntoView({
    behavior: smooth ? "smooth" : "auto",
    block: "nearest",
  });
}
