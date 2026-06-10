"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PageData = {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
};

const RENDER_SCALE = 3.0;

export default function PdfViewer() {
  const [pages, setPages] = useState<PageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  const [fileDragging, setFileDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const zoomRef = useRef(zoom);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const processPdf = useCallback(async (file: File) => {
    if (!file || file.type !== "application/pdf") {
      alert("올바른 PDF 파일을 업로드해주세요.");
      return;
    }
    setLoading(true);
    setPages([]);
    setCurrentPage(1);
    setFileName(file.name);
    pageRefs.current = [];

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
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        pagesData.push({
          pageNumber: i,
          dataUrl: canvas.toDataURL("image/jpeg", 0.9),
          width: viewport.width,
          height: viewport.height,
        });
        setLoadingProgress({ current: i, total: totalPages });
        await new Promise((r) => setTimeout(r, 0));
      }

      setPages(pagesData);
    } catch (err) {
      console.error(err);
      alert("PDF 처리에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }, []);

  // IntersectionObserver for current page
  useEffect(() => {
    if (pages.length === 0) return;
    const observers: IntersectionObserver[] = [];
    pageRefs.current.forEach((el, index) => {
      if (!el) return;
      const observer = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setCurrentPage(index + 1); },
        { root: scrollRef.current, threshold: 0.3 }
      );
      observer.observe(el);
      observers.push(observer);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, [pages]);

  // Auto-scroll sidebar thumbnail
  useEffect(() => {
    if (!sidebarRef.current) return;
    const thumb = sidebarRef.current.querySelector(`[data-page="${currentPage}"]`);
    thumb?.scrollIntoView({ block: "nearest" });
  }, [currentPage]);

  // Mouse drag-to-pan (desktop)
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!panRef.current || !scrollRef.current) return;
      scrollRef.current.scrollLeft = panRef.current.scrollLeft - (e.clientX - panRef.current.x);
      scrollRef.current.scrollTop = panRef.current.scrollTop - (e.clientY - panRef.current.y);
    };
    const onMouseUp = () => {
      panRef.current = null;
      setIsPanning(false);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Pinch-to-zoom (mobile)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const getDistance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchRef.current = { distance: getDistance(e.touches), zoom: zoomRef.current };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const scale = getDistance(e.touches) / pinchRef.current.distance;
        const newZoom = Math.min(3, Math.max(0.25, +(pinchRef.current.zoom * scale).toFixed(2)));
        setZoom(newZoom);
      }
    };

    const onTouchEnd = () => { pinchRef.current = null; };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current || pages.length === 0) return;
    panRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: scrollRef.current.scrollLeft,
      scrollTop: scrollRef.current.scrollTop,
    };
    setIsPanning(true);
  };

  const scrollToPage = (pageNumber: number) => {
    pageRefs.current[pageNumber - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const goPrev = () => { if (currentPage > 1) scrollToPage(currentPage - 1); };
  const goNext = () => { if (currentPage < pages.length) scrollToPage(currentPage + 1); };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processPdf(file);
    e.target.value = "";
  };

  const onFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setFileDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processPdf(file);
  };

  const zoomIn = () => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)));

  return (
    <div className="flex h-[calc(100vh-49px)]">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={onFileChange}
      />

      {/* 썸네일 사이드바 — 모바일에서 숨김 */}
      {pages.length > 0 && (
        <aside
          ref={sidebarRef}
          className="hidden md:block w-36 shrink-0 bg-white border-r border-gray-200 overflow-y-auto py-3"
        >
          {pages.map((page) => (
            <button
              key={page.pageNumber}
              data-page={page.pageNumber}
              onClick={() => scrollToPage(page.pageNumber)}
              className="w-full px-2 mb-2 text-left"
            >
              <div
                className={`rounded-lg overflow-hidden border-2 transition-all ${
                  currentPage === page.pageNumber
                    ? "border-blue-500"
                    : "border-transparent hover:border-gray-200"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={page.dataUrl}
                  alt={`${page.pageNumber}페이지`}
                  className="w-full block"
                  draggable={false}
                />
              </div>
              <p
                className={`text-xs text-center mt-1 ${
                  currentPage === page.pageNumber
                    ? "text-blue-500 font-medium"
                    : "text-gray-400"
                }`}
              >
                {page.pageNumber}
              </p>
            </button>
          ))}
        </aside>
      )}

      {/* 메인 영역 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 툴바 */}
        {(pages.length > 0 || loading) && (
          <div className="bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-2 shrink-0">
            <span className="text-xs sm:text-sm text-gray-600 truncate flex-1 min-w-0 hidden sm:block">
              {fileName}
            </span>

            {pages.length > 0 && (
              <>
                <button
                  onClick={goPrev}
                  disabled={currentPage <= 1}
                  className="md:hidden w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-30 transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                <span className="text-xs text-gray-400 shrink-0">
                  {currentPage} / {pages.length}
                </span>

                <button
                  onClick={goNext}
                  disabled={currentPage >= pages.length}
                  className="md:hidden w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-30 transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={zoomOut}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold transition-colors"
              >
                −
              </button>
              <span className="text-xs w-9 text-center text-gray-600">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={zoomIn}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold transition-colors"
              >
                +
              </button>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs px-2 sm:px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors shrink-0"
            >
              파일 열기
            </button>
          </div>
        )}

        {/* 스크롤 영역 */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto select-none"
          style={{
            backgroundColor: "#525659",
            cursor: pages.length > 0 ? (isPanning ? "grabbing" : "grab") : "default",
          }}
          onMouseDown={handleMouseDown}
          onDragOver={(e) => { e.preventDefault(); setFileDragging(true); }}
          onDragLeave={() => setFileDragging(false)}
          onDrop={onFileDrop}
        >
          {/* 업로드 전 */}
          {!loading && pages.length === 0 && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`max-w-lg mx-auto my-12 sm:my-20 mx-4 sm:mx-auto border-2 border-dashed rounded-2xl p-10 sm:p-16 text-center cursor-pointer transition-colors ${
                fileDragging ? "border-blue-400 bg-white/5" : "border-gray-500 hover:border-gray-400"
              }`}
            >
              <svg
                className="w-10 h-10 sm:w-12 sm:h-12 text-gray-400 mx-auto mb-3"
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
              <p className="text-sm sm:text-base font-semibold text-gray-300">
                PDF를 드롭하거나 클릭해서 열기
              </p>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">모든 PDF 파일 지원</p>
            </div>
          )}

          {/* 로딩 */}
          {loading && (
            <div className="max-w-xs mx-auto mt-16 sm:mt-20 px-6">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-300">페이지 렌더링 중...</span>
                <span className="text-sm text-gray-400">
                  {loadingProgress.current} / {loadingProgress.total}
                </span>
              </div>
              <div className="h-1.5 bg-gray-600 rounded-full overflow-hidden">
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

          {/* 페이지 렌더링 */}
          {pages.length > 0 && (
            <div
              className="py-6 sm:py-8 flex flex-col items-center gap-4 sm:gap-6 px-3 sm:px-8"
              style={{ minWidth: "max-content" }}
            >
              {pages.map((page, index) => (
                <div
                  key={page.pageNumber}
                  ref={(el) => { pageRefs.current[index] = el; }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.dataUrl}
                    alt={`${page.pageNumber}페이지`}
                    style={{ width: `${(page.width / RENDER_SCALE) * zoom}px` }}
                    className="block shadow-2xl"
                    draggable={false}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
