"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PageData = {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
};

type Format = "png" | "jpeg";
type Quality = "low" | "medium" | "high";

const QUALITY_SCALE: Record<Quality, number> = {
  low: 1.5,
  medium: 2.0,
  high: 3.0,
};

export default function PdfToImage() {
  const [pages, setPages] = useState<PageData[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [format, setFormat] = useState<Format>("png");
  const [quality, setQuality] = useState<Quality>("medium");
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processPdf = useCallback(async (file: File, renderQuality: Quality) => {
    if (!file || file.type !== "application/pdf") {
      alert("Please upload a valid PDF file.");
      return;
    }

    setLoading(true);
    setPages([]);
    setSelected(new Set());
    setFileName(file.name);

    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdf.numPages;

      setLoadingProgress({ current: 0, total: totalPages });

      const pagesData: PageData[] = [];

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: QUALITY_SCALE[renderQuality] });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;

        await page.render({ canvas, canvasContext: ctx, viewport }).promise;

        const dataUrl = canvas.toDataURL("image/png");
        pagesData.push({
          pageNumber: i,
          dataUrl,
          width: viewport.width,
          height: viewport.height,
        });

        setLoadingProgress({ current: i, total: totalPages });
        await new Promise((r) => setTimeout(r, 0));
      }

      setPages(pagesData);
      setSelected(new Set(pagesData.map((p) => p.pageNumber)));
    } catch (err) {
      console.error(err);
      alert("Failed to process PDF. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processPdf(file, quality);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processPdf(file, quality);
  };

  const togglePage = (pageNumber: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pageNumber)) next.delete(pageNumber);
      else next.add(pageNumber);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(pages.map((p) => p.pageNumber)));
  const deselectAll = () => setSelected(new Set());

  const openViewer = (index: number) => {
    setViewingIndex(index);
    setZoom(1);
  };

  const closeViewer = () => setViewingIndex(null);

  const goPrev = () => {
    if (viewingIndex === null) return;
    setViewingIndex((i) => (i! > 0 ? i! - 1 : i));
    setZoom(1);
  };

  const goNext = () => {
    if (viewingIndex === null) return;
    setViewingIndex((i) => (i! < pages.length - 1 ? i! + 1 : i));
    setZoom(1);
  };

  useEffect(() => {
    if (viewingIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeViewer();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const downloadSelected = async () => {
    const toDownload = pages.filter((p) => selected.has(p.pageNumber));
    if (toDownload.length === 0) {
      alert("No pages selected.");
      return;
    }

    setDownloading(true);

    try {
      const mimeType = format === "png" ? "image/png" : "image/jpeg";
      const ext = format === "png" ? "png" : "jpg";

      const getDataUrl = (page: PageData): string => {
        if (format === "png") return page.dataUrl;
        const canvas = document.createElement("canvas");
        canvas.width = page.width;
        canvas.height = page.height;
        const ctx = canvas.getContext("2d")!;
        const img = new Image();
        img.src = page.dataUrl;
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL(mimeType, 0.9);
      };

      if (toDownload.length === 1) {
        const page = toDownload[0];
        const dataUrl = getDataUrl(page);
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `page-${page.pageNumber}.${ext}`;
        a.click();
      } else {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();

        for (const page of toDownload) {
          const dataUrl = getDataUrl(page);
          const base64 = dataUrl.split(",")[1];
          zip.file(`page-${String(page.pageNumber).padStart(3, "0")}.${ext}`, base64, {
            base64: true,
          });
        }

        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `pages.zip`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error(err);
      alert("Download failed. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const viewingPage = viewingIndex !== null ? pages[viewingIndex] : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">PDF to Image</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Convert PDF pages to PNG or JPG — 100% in your browser, no upload needed.
        </p>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Upload area */}
        <div
          className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors ${
            dragging
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/30"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={onFileChange}
          />
          <div className="flex flex-col items-center gap-3 pointer-events-none">
            <svg
              className="w-12 h-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <div>
              {fileName && !loading ? (
                <>
                  <p className="text-base font-semibold text-gray-700">{fileName}</p>
                  <p className="text-sm text-gray-400 mt-1">
                    {pages.length} pages · Click or drop to replace
                  </p>
                </>
              ) : (
                <>
                  <p className="text-base font-semibold text-gray-700">
                    Drop a PDF here or click to browse
                  </p>
                  <p className="text-sm text-gray-400 mt-1">Supports any PDF file</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Quality selector — only before upload */}
        {pages.length === 0 && !loading && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">Quality:</span>
            <div className="flex rounded-lg overflow-hidden border border-gray-200 bg-white">
              {(["low", "medium", "high"] as Quality[]).map((q) => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className={`px-3 py-1 text-xs font-medium transition-colors capitalize ${
                    quality === q
                      ? "bg-blue-500 text-white"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">
              {quality === "low" && "빠름 · 화면 표시용"}
              {quality === "medium" && "권장 · 레티나 수준"}
              {quality === "high" && "고화질 · 인쇄용"}
            </span>
          </div>
        )}

        {/* Loading progress */}
        {loading && (
          <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                {fileName && (
                  <span className="text-gray-400 mr-2">{fileName}</span>
                )}
                Rendering pages...
              </span>
              <span className="text-sm text-gray-500">
                {loadingProgress.current} / {loadingProgress.total}
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{
                  width:
                    loadingProgress.total > 0
                      ? `${(loadingProgress.current / loadingProgress.total) * 100}%`
                      : "0%",
                }}
              />
            </div>
          </div>
        )}

        {/* Controls */}
        {pages.length > 0 && !loading && (
          <div className="mt-6 bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center gap-4">
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
              >
                Select All
              </button>
              <button
                onClick={deselectAll}
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
              >
                Deselect All
              </button>
            </div>

            <div className="h-6 w-px bg-gray-200" />

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Format:</span>
              <div className="flex rounded-lg overflow-hidden border border-gray-200">
                {(["png", "jpeg"] as Format[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      format === f
                        ? "bg-blue-500 text-white"
                        : "bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1" />

            <button
              onClick={downloadSelected}
              disabled={selected.size === 0 || downloading}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                selected.size === 0 || downloading
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600 text-white"
              }`}
            >
              {downloading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  Preparing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Download {selected.size} page{selected.size !== 1 ? "s" : ""}
                  {selected.size > 1 ? " (ZIP)" : ` (.${format === "jpeg" ? "jpg" : "png"})`}
                </>
              )}
            </button>
          </div>
        )}

        {/* Thumbnail grid */}
        {pages.length > 0 && !loading && (
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {pages.map((page, index) => {
              const isSelected = selected.has(page.pageNumber);
              return (
                <div
                  key={page.pageNumber}
                  className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all group ${
                    isSelected
                      ? "border-blue-500 shadow-md shadow-blue-100"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                  onClick={() => openViewer(index)}
                >
                  {/* Checkbox — toggles selection, doesn't open viewer */}
                  <div
                    className={`absolute top-2 left-2 w-5 h-5 rounded-md border-2 flex items-center justify-center z-10 transition-colors ${
                      isSelected
                        ? "bg-blue-500 border-blue-500"
                        : "bg-white/80 border-gray-400"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePage(page.pageNumber);
                    }}
                  >
                    {isSelected && (
                      <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>

                  {/* Page number badge */}
                  <div className="absolute top-2 right-2 bg-black/60 text-white text-xs font-medium px-1.5 py-0.5 rounded-md z-10">
                    {page.pageNumber}
                  </div>

                  {/* Zoom hint on hover */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                    <div className="bg-black/50 rounded-full p-2">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16zm0-5v-6m-3 3h6" />
                      </svg>
                    </div>
                  </div>

                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.dataUrl}
                    alt={`Page ${page.pageNumber}`}
                    className="w-full h-auto block"
                    loading="lazy"
                  />

                  {isSelected && (
                    <div className="absolute inset-0 bg-blue-500/10 pointer-events-none" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Page viewer modal */}
      {viewingPage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex flex-col"
          onClick={closeViewer}
        >
          {/* Modal toolbar */}
          <div
            className="flex items-center justify-between px-4 py-3 bg-black/60 text-white shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left: file + page info */}
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm text-gray-300 truncate max-w-xs">{fileName}</span>
              <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">
                {viewingPage.pageNumber} / {pages.length}
              </span>
            </div>

            {/* Center: zoom controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-lg font-bold"
              >
                −
              </button>
              <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-lg font-bold"
              >
                +
              </button>
              <button
                onClick={() => setZoom(1)}
                className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                Reset
              </button>
            </div>

            {/* Right: close */}
            <button
              onClick={closeViewer}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Image area */}
          <div
            className="flex-1 overflow-auto flex items-start justify-center p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewingPage.dataUrl}
              alt={`Page ${viewingPage.pageNumber}`}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top center",
                transition: "transform 0.15s ease",
              }}
              className="max-w-full shadow-2xl rounded"
              draggable={false}
            />
          </div>

          {/* Prev / Next arrows */}
          {viewingIndex! > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); goPrev(); }}
              className="fixed left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {viewingIndex! < pages.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); goNext(); }}
              className="fixed right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
