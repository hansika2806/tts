/**
 * PDF Book Reader
 * Lazy-loads canvases and progressively extracts text to prevent freezing on huge PDFs.
 */

let pdfjsLib = null;

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

  onStatus?.("Loading PDF parser…");
  const lib = await getPdfJs();

  onStatus?.("Parsing PDF document…");
  const buffer = await file.arrayBuffer();
  const pdfDoc = await lib.getDocument({ data: buffer }).promise;

  const SCALE = 1.5;
  const allChunks = []; // { id, text, pageIndex, bounds, itemIndex }
  let globalChunkId = 0;

  containerEl.classList.remove("pdf-loading");
  const docTitle = file.name.replace(/\.[^.]+$/, "");
  containerEl.dataset.title = docTitle;

  // Get first page to determine skeleton aspect ratio
  const page1 = await pdfDoc.getPage(1);
  const vp1 = page1.getViewport({ scale: SCALE });

  const pageWrappers = [];

  // Setup Lazy Rendering via IntersectionObserver
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const pNum = parseInt(entry.target.dataset.page);
        if (!entry.target.dataset.rendered) {
          entry.target.dataset.rendered = "true";
          renderPageVisuals(pdfDoc, pNum, entry.target, SCALE);
        }
      }
    });
  }, { rootMargin: "800px 0px" });

  // Create skeleton pages instantly
  for (let pNum = 1; pNum <= pdfDoc.numPages; pNum++) {
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page";
    wrapper.dataset.page = String(pNum);
    wrapper.style.width = vp1.width + "px";
    wrapper.style.height = vp1.height + "px";
    wrapper.style.backgroundColor = "#fff"; // skeleton background
    
    // Add page number label
    const label = document.createElement("div");
    label.className = "pdf-page-label";
    label.textContent = `Page ${pNum}`;
    label.style.zIndex = "10";
    wrapper.appendChild(label);

    containerEl.appendChild(wrapper);
    pageWrappers.push(wrapper);
    io.observe(wrapper);
  }

  // Background Text Extraction Process
  // We extract text in chunks (lines/sentences) so TTS can start immediately
  setTimeout(async () => {
    for (let pNum = 1; pNum <= pdfDoc.numPages; pNum++) {
      onStatus?.(`Extracting page ${pNum} / ${pdfDoc.numPages}…`);
      
      try {
        const page = await pdfDoc.getPage(pNum);
        const textContent = await page.getTextContent();
        const items = textContent.items.filter(i => i.str.trim());
        
        // Group items into reasonable chunks (by line/paragraph)
        let currentChunk = "";
        let currentItems = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          currentChunk += (currentChunk ? " " : "") + item.str;
          currentItems.push(i); // keep track of which items form this chunk

          // End chunk on punctuation or long gaps
          if (/[.?!]$/.test(item.str) || currentChunk.length > 150 || i === items.length - 1) {
            const chunkObj = {
              id: globalChunkId++,
              text: currentChunk.replace(/\s+/g, " ").trim(),
              pageIndex: pNum - 1,
              itemIndices: currentItems
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

      // Yield to event loop every 5 pages to prevent browser lockup on 3k pages
      if (pNum % 5 === 0) {
        await new Promise(r => setTimeout(r, 10));
      }
    }
    onFinished?.();
  }, 50);

  return { title: docTitle, pageCount: pdfDoc.numPages, pageWrappers };
}

// Lazy renders the canvas and transparent text layer for right-click interaction
async function renderPageVisuals(pdfDoc, pageNum, wrapper, SCALE) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: SCALE });
    
    // Adjust skeleton size to actual page size
    wrapper.style.width = viewport.width + "px";
    wrapper.style.height = viewport.height + "px";

    // 1. Render Canvas
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrapper.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    // 2. Render Text Layer for Highlights & Clicking
    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "pdf-text-layer";
    textLayerDiv.style.width = viewport.width + "px";
    textLayerDiv.style.height = viewport.height + "px";
    wrapper.appendChild(textLayerDiv);

    const textContent = await page.getTextContent();
    const items = textContent.items.filter(i => i.str.trim());

    items.forEach((item, idx) => {
      const span = document.createElement("span");
      span.textContent = item.str;
      // map transform
      const left = item.transform[4] * SCALE;
      const top = viewport.height - (item.transform[5] * SCALE);
      const fontSize = item.transform[0] * SCALE;
      
      span.style.left = left + "px";
      span.style.top = (top - fontSize) + "px";
      span.style.fontSize = fontSize + "px";
      span.dataset.itemIdx = String(idx); // To map back to the chunk
      
      // Double click event to "Start reading from here"
      span.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const event = new CustomEvent("pdf-start-from", { 
          detail: { pageIndex: pageNum - 1, itemIdx: idx }
        });
        window.dispatchEvent(event);
      });

      textLayerDiv.appendChild(span);
    });

  } catch (err) {
    console.error(`Render failed for page ${pageNum}`, err);
  }
}

/**
 * Highlights a specific chunk by adding classes to its spans.
 */
export function highlightChunk(chunk, pageWrappers) {
  // Clear old highlights across all pages
  pageWrappers.forEach(w => {
    w.classList.remove("pdf-page-active");
    w.querySelectorAll(".pdf-highlight").forEach(el => el.classList.remove("pdf-highlight"));
  });

  if (!chunk) return;

  const wrapper = pageWrappers[chunk.pageIndex];
  if (!wrapper) return;

  wrapper.classList.add("pdf-page-active");

  // If text layer is rendered, highlight specific spans
  const textLayer = wrapper.querySelector(".pdf-text-layer");
  if (textLayer) {
    chunk.itemIndices.forEach(idx => {
      const span = textLayer.querySelector(`span[data-item-idx="${idx}"]`);
      if (span) span.classList.add("pdf-highlight");
    });
  }

  // Smooth scroll
  wrapper.scrollIntoView({ behavior: "smooth", block: "center" });
}
