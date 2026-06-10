"use client";

import { useCallback, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type PageItem =
  | {
      id: string;
      type: "pdf-page";
      sourceFile: string;
      sourceBuffer: ArrayBuffer;
      pageIndex: number;
      pageNumber: number;
      totalPages: number;
      dataUrl: string;
    }
  | {
      id: string;
      type: "image";
      name: string;
      dataUrl: string;
      width: number;
      height: number;
      fileType: string;
      arrayBuffer: ArrayBuffer;
    };

async function toEmbeddableBuffer(
  item: Extract<PageItem, { type: "image" }>
): Promise<{ buffer: ArrayBuffer; isJpeg: boolean }> {
  const isJpeg = item.fileType === "image/jpeg";
  const isPng = item.fileType === "image/png";
  if (isJpeg || isPng) return { buffer: item.arrayBuffer, isJpeg };
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = item.width;
    canvas.height = item.height;
    const ctx = canvas.getContext("2d")!;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        if (!blob) { reject(new Error("변환 실패")); return; }
        resolve({ buffer: await blob.arrayBuffer(), isJpeg: false });
      }, "image/png");
    };
    img.onerror = reject;
    img.src = item.dataUrl;
  });
}

async function loadPdfPages(file: File): Promise<PageItem[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
  const total = pdf.numPages;
  const pages: PageItem[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 0.4 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    pages.push({
      id: `${file.name}-p${i}-${Date.now()}-${Math.random()}`,
      type: "pdf-page",
      sourceFile: file.name,
      sourceBuffer: arrayBuffer,
      pageIndex: i - 1,
      pageNumber: i,
      totalPages: total,
      dataUrl: canvas.toDataURL("image/jpeg", 0.7),
    });
    await new Promise((r) => setTimeout(r, 0));
  }
  return pages;
}

async function loadImagePage(file: File): Promise<PageItem> {
  const arrayBuffer = await file.arrayBuffer();
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target!.result as string);
    reader.readAsDataURL(file);
  });
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = dataUrl;
  });
  return {
    id: `${file.name}-${Date.now()}-${Math.random()}`,
    type: "image",
    name: file.name,
    dataUrl,
    width,
    height,
    fileType: file.type,
    arrayBuffer,
  };
}

function SortablePageItem({
  item,
  onRemove,
}: {
  item: PageItem;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const label =
    item.type === "pdf-page"
      ? `${item.sourceFile.replace(/\.pdf$/i, "")} · ${item.pageNumber}/${item.totalPages}`
      : item.name;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      className="relative rounded-xl overflow-hidden border-2 border-gray-200 group cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      {/* 페이지 번호 배지 */}
      <div className="absolute top-2 left-2 bg-black/60 text-white text-xs font-medium px-1.5 py-0.5 rounded-md z-10 select-none">
        {item.type === "pdf-page" ? item.pageNumber : "IMG"}
      </div>

      {/* 삭제 버튼 */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded-full bg-black/60 hover:bg-red-500 text-white z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.dataUrl}
        alt={label}
        className="w-full h-auto block pointer-events-none select-none"
        loading="lazy"
        draggable={false}
      />

      {/* 파일명 호버 레이블 */}
      <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-xs px-2 py-1 truncate opacity-0 group-hover:opacity-100 transition-opacity select-none">
        {label}
      </div>
    </div>
  );
}

export default function PdfMerge() {
  const [items, setItems] = useState<PageItem[]>([]);
  const [fileDragging, setFileDragging] = useState(false);
  const [merging, setMerging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((i) => i.id === active.id);
        const newIndex = prev.findIndex((i) => i.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(
      (f) => f.type === "application/pdf" || f.type.startsWith("image/")
    );
    if (fileArray.length === 0) return;
    setLoading(true);
    try {
      const allPages: PageItem[] = [];
      for (const file of fileArray) {
        setLoadingStatus(file.name);
        if (file.type === "application/pdf") {
          const pages = await loadPdfPages(file);
          allPages.push(...pages);
        } else {
          allPages.push(await loadImagePage(file));
        }
      }
      setItems((prev) => [...prev, ...allPages]);
    } catch (err) {
      console.error(err);
      alert("파일을 불러오는데 실패했습니다.");
    } finally {
      setLoading(false);
      setLoadingStatus("");
    }
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setFileDragging(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  const merge = async () => {
    if (items.length < 2) return;
    setMerging(true);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const merged = await PDFDocument.create();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfCache = new Map<ArrayBuffer, any>();

      for (const item of items) {
        if (item.type === "pdf-page") {
          let srcDoc = pdfCache.get(item.sourceBuffer);
          if (!srcDoc) {
            srcDoc = await PDFDocument.load(item.sourceBuffer.slice(0));
            pdfCache.set(item.sourceBuffer, srcDoc);
          }
          const [copiedPage] = await merged.copyPages(srcDoc, [item.pageIndex]);
          merged.addPage(copiedPage);
        } else {
          const { buffer, isJpeg } = await toEmbeddableBuffer(item);
          const embedded = isJpeg
            ? await merged.embedJpg(buffer)
            : await merged.embedPng(buffer);
          const page = merged.addPage([item.width, item.height]);
          page.drawImage(embedded, { x: 0, y: 0, width: item.width, height: item.height });
        }
      }

      const bytes = await merged.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "merged.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("PDF 병합에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setMerging(false);
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
      {/* 업로드 영역 */}
      <div
        className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-colors ${
          fileDragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/30"
        }`}
        onDragOver={(e) => { e.preventDefault(); setFileDragging(true); }}
        onDragLeave={() => setFileDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          className="hidden"
          onChange={onFileChange}
        />
        <div className="flex flex-col items-center gap-3 pointer-events-none">
          <svg className="w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div>
            {items.length > 0 ? (
              <>
                <p className="text-base font-semibold text-gray-700">{items.length}페이지 추가됨</p>
                <p className="text-sm text-gray-400 mt-1">클릭하거나 드롭해서 더 추가</p>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-gray-700">
                  PDF 또는 이미지를 드롭하거나 클릭해서 추가
                </p>
                <p className="text-sm text-gray-400 mt-1">PDF, PNG, JPG, WEBP 등 · 여러 파일 선택 가능</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="mt-4 text-sm text-center text-gray-400">
          {loadingStatus ? `읽는 중: ${loadingStatus}` : "파일 읽는 중..."}
        </div>
      )}

      {/* 컨트롤 + 그리드 */}
      {items.length > 0 && !loading && (
        <>
          <div className="mt-6 bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-500">
              {items.length}페이지 · 드래그해서 순서 조정
            </span>
            <button
              onClick={merge}
              disabled={items.length < 2 || merging}
              className={`ml-auto flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                items.length < 2 || merging
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600 text-white"
              }`}
            >
              {merging ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  병합 중...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  PDF 병합 ({items.length}페이지)
                </>
              )}
            </button>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                {items.map((item) => (
                  <SortablePageItem key={item.id} item={item} onRemove={removeItem} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}
    </main>
  );
}
