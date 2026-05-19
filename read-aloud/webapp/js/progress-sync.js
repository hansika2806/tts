import { idbGetAllBooks, idbGetBook, idbPutBook } from "./idb.js";

export async function exportProgressBundle(state) {
  const books = await idbGetAllBooks();
  const bundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    preferences: {
      provider: state.provider,
      voiceId: state.voiceId,
      dialogueVoiceId: state.dialogueVoiceId,
      chunkMode: state.chunkMode,
      rate: state.rate,
      pitch: state.pitch,
      volume: state.volume,
      playbackMode: state.playbackMode,
    },
    books: books.map((b) => ({
      id: b.id,
      title: b.title,
      type: b.type,
      progress: b.progress,
      bookmarks: b.bookmarks,
      pronunciations: b.pronunciations,
      lastOpenedAt: b.lastOpenedAt,
    })),
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "read-aloud-progress.json";
  a.click();
  URL.revokeObjectURL(url);
}

export async function importProgressBundle(file, state, reloadLibrary) {
  const raw = JSON.parse(await file.text());
  if (!raw?.books) throw new Error("Invalid progress file");

  for (const meta of raw.books) {
    const existing = await idbGetBook(meta.id);
    if (existing) {
      existing.progress = meta.progress ?? existing.progress;
      existing.bookmarks = meta.bookmarks ?? existing.bookmarks;
      existing.pronunciations = meta.pronunciations ?? existing.pronunciations;
      existing.lastOpenedAt = meta.lastOpenedAt ?? existing.lastOpenedAt;
      await idbPutBook(existing);
    }
  }

  if (raw.preferences) {
    Object.assign(state, raw.preferences);
  }
  await reloadLibrary?.();
}
