let pdfjsLibPromise;

export async function extractTextFromPdf(file, onStatus) {
  onStatus?.("Loading PDF parser...");
  const pdfjsLib = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  onStatus?.("Reading PDF pages...");
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onStatus?.(`Extracting page ${pageNumber} of ${pdf.numPages}...`);
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageText) pages.push(pageText);
  }

  return {
    title: file.name.replace(/\.[^.]+$/, ""),
    text: pages.join("\n\n"),
    pageCount: pdf.numPages,
  };
}

async function getPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs")
      .then((module) => {
        module.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";
        return module;
      });
  }
  return pdfjsLibPromise;
}
