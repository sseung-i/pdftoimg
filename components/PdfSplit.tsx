"use client";

import { useCallback, useRef, useState } from "react";

type PageData = {
  pageNumber: number;
  dataUrl: string;
};

export default function PdfSplit() {
  const [pages, setPages] = useState<PageData[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processPdf = useCallback(async (file: File) => {
    if (!file || file.type !== "application/pdf") {
      alert("올바른 PDF 파일을 업로드해주세요.");
      return;
    }
    setLoading(true);
    setPages([]);
    setSelected(new Set());
    setFileName(file.name);

    try {
      const arrayBuffer = await file.arrayBuffer();
      setPdfBuffer(arrayBuffer.slice(0));

      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      const totalPages = pdf.numPages;
      setLoadingProgress({ current: 0, total: totalPages });

      const pagesData: PageData[] = [];

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        pagesData.push({
          pageNumber: i,
          dataUrl: canvas.toDataURL("image/jpeg", 0.7),
        });
        setLoadingProgress({ current: i, total: totalPages });
        await new Promise((r) => setTimeout(r, 0));
      }

      setPages(pagesData);
      setSelected(new Set(pagesData.map((p) => p.pageNumber)));
    } catch (err) {
      console.error(err);
      alert("PDF 처리에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processPdf(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processPdf(file);
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

  // 선택한 페이지를 하나의 PDF로 추출
  const extractAsPdf = async () => {
    if (!pdfBuffer || selected.size === 0) return;
    setExporting(true);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const srcDoc = await PDFDocument.load(pdfBuffer.slice(0));
      const newDoc = await PDFDocument.create();
      const sortedIndices = [...selected].sort((a, b) => a - b).map((n) => n - 1);
      const copiedPages = await newDoc.copyPages(srcDoc, sortedIndices);
      copiedPages.forEach((page) => newDoc.addPage(page));

      const bytes = await newDoc.save();
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const sorted = [...selected].sort((a, b) => a - b);
      const label = selected.size === 1
        ? `p${sorted[0]}`
        : `p${sorted[0]}-${sorted[sorted.length - 1]}`;
      a.download = `${fileName?.replace(".pdf", "") ?? "document"}_${label}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("PDF 추출에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setExporting(false);
    }
  };

  // 선택한 페이지를 각각 개별 PDF로 분리 → ZIP
  const splitIntoZip = async () => {
    if (!pdfBuffer || selected.size === 0) return;
    setExporting(true);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const JSZip = (await import("jszip")).default;
      const srcDoc = await PDFDocument.load(pdfBuffer.slice(0));
      const zip = new JSZip();
      const baseName = fileName?.replace(".pdf", "") ?? "page";

      for (const pageNum of [...selected].sort((a, b) => a - b)) {
        const newDoc = await PDFDocument.create();
        const [copiedPage] = await newDoc.copyPages(srcDoc, [pageNum - 1]);
        newDoc.addPage(copiedPage);
        const bytes = await newDoc.save();
        zip.file(`${baseName}_p${String(pageNum).padStart(3, "0")}.pdf`, bytes);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}_split.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("PDF 분할에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
      {/* Upload area */}
      <div
        className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/30"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
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
          <svg className="w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <div>
            {fileName && !loading ? (
              <>
                <p className="text-base font-semibold text-gray-700">{fileName}</p>
                <p className="text-sm text-gray-400 mt-1">
                  {pages.length}페이지 · 클릭하거나 드롭해서 교체
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-gray-700">
                  분할할 PDF를 드롭하거나 클릭해서 업로드
                </p>
                <p className="text-sm text-gray-400 mt-1">모든 PDF 파일 지원</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Loading progress */}
      {loading && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              {fileName && <span className="text-gray-400 mr-2">{fileName}</span>}
              페이지 읽는 중...
            </span>
            <span className="text-sm text-gray-500">
              {loadingProgress.current} / {loadingProgress.total}
            </span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{
                width: loadingProgress.total > 0
                  ? `${(loadingProgress.current / loadingProgress.total) * 100}%`
                  : "0%",
              }}
            />
          </div>
        </div>
      )}

      {/* Controls */}
      {pages.length > 0 && !loading && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
            >
              전체 선택
            </button>
            <button
              onClick={deselectAll}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
            >
              전체 해제
            </button>
          </div>

          <span className="text-sm text-gray-400 ml-auto">{selected.size}페이지 선택됨</span>

          {/* 선택 페이지 → 하나의 PDF */}
          <button
            onClick={extractAsPdf}
            disabled={selected.size === 0 || exporting}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              selected.size === 0 || exporting
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            {exporting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                처리 중...
              </>
            ) : (
              "선택 페이지 추출"
            )}
          </button>

          {/* 선택 페이지 → 개별 PDF → ZIP */}
          <button
            onClick={splitIntoZip}
            disabled={selected.size === 0 || exporting}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              selected.size === 0 || exporting
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-gray-800 hover:bg-gray-900 text-white"
            }`}
          >
            페이지별 분리 (ZIP)
          </button>
        </div>
      )}

      {/* Thumbnail grid */}
      {pages.length > 0 && !loading && (
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {pages.map((page) => {
            const isSelected = selected.has(page.pageNumber);
            return (
              <div
                key={page.pageNumber}
                onClick={() => togglePage(page.pageNumber)}
                className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${
                  isSelected
                    ? "border-blue-500 shadow-md shadow-blue-100"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div
                  className={`absolute top-2 left-2 w-5 h-5 rounded-md border-2 flex items-center justify-center z-10 transition-colors ${
                    isSelected ? "bg-blue-500 border-blue-500" : "bg-white/80 border-gray-400"
                  }`}
                >
                  {isSelected && (
                    <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>

                <div className="absolute top-2 right-2 bg-black/60 text-white text-xs font-medium px-1.5 py-0.5 rounded-md z-10">
                  {page.pageNumber}
                </div>

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={page.dataUrl}
                  alt={`${page.pageNumber}페이지`}
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
  );
}
