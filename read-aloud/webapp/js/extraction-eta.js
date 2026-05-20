/**
 * ETA estimation for PDF text extraction progress UI.
 */

let startedAt = 0;
let lastPage = 0;
let lastPageAt = 0;

export function resetExtractionEta() {
  startedAt = 0;
  lastPage = 0;
  lastPageAt = 0;
}

export function markExtractionPage(page, totalPages) {
  const now = Date.now();
  if (!startedAt || page <= lastPage) {
    if (!startedAt) startedAt = now;
    if (page > 0) {
      lastPage = page;
      lastPageAt = now;
    }
    return estimateExtractionEta(page, totalPages);
  }
  lastPage = page;
  lastPageAt = now;
  return estimateExtractionEta(page, totalPages);
}

export function estimateExtractionEta(page, totalPages) {
  if (!totalPages || totalPages <= 0) {
    return { secondsLeft: null, label: "Estimating…", pct: 0 };
  }

  const pct = Math.min(100, Math.round((page / totalPages) * 100));

  if (page <= 0) {
    const warmupPct = totalPages > 0 ? 2 : 0;
    return {
      secondsLeft: null,
      label: totalPages > 0 ? `Scanning ${totalPages} pages…` : "Starting scan…",
      pct: warmupPct,
    };
  }

  const elapsedMs = Math.max(1, Date.now() - startedAt);
  const msPerPage = elapsedMs / page;
  const pagesLeft = Math.max(0, totalPages - page);
  const secondsLeft = Math.ceil((msPerPage * pagesLeft) / 1000);

  return {
    secondsLeft,
    label: formatEtaLabel(secondsLeft),
    pct,
  };
}

export function formatEtaLabel(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return "Estimating…";
  if (seconds < 5) return "Almost ready…";
  if (seconds < 60) return `About ${seconds}s left`;
  const mins = Math.ceil(seconds / 60);
  if (mins === 1) return "About 1 min left";
  if (mins < 60) return `About ${mins} min left`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem === 0) return `About ${hours} hr left`;
  return `About ${hours} hr ${rem} min left`;
}
