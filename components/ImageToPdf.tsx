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

type ImageItem = {
  id: string;
  dataUrl: string;
  name: string;
  width: number;
  height: number;
  fileType: string;
  arrayBuffer: ArrayBuffer;
};

type PageSize = "original" | "a4";

const A4 = { width: 595.28, height: 841.89 };

const loadImageItem = (file: File): Promise<ImageItem> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target!.result as string;
      const arrayBuffer = await file.arrayBuffer();
      const img = new Image();
      img.onload = () => {
        resolve({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          dataUrl,
          name: file.name,
          width: img.naturalWidth,
          height: img.naturalHeight,
          fileType: file.type,
          arrayBuffer,
        });
      };
      img.onerror = reject;
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });

const toEmbeddableBuffer = (
  image: ImageItem
): Promise<{ buffer: ArrayBuffer; isJpeg: boolean }> => {
  const isJpeg = image.fileType === "image/jpeg";
  const isPng = image.fileType === "image/png";
  if (isJpeg || isPng) {
    return Promise.resolve({ buffer: image.arrayBuffer, isJpeg });
  }
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
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
    img.src = image.dataUrl;
  });
};

function SortableImageItem({
  image,
  index,
  isSelected,
  onToggle,
  onRemove,
}: {
  image: ImageItem;
  index: number;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={`relative rounded-xl overflow-hidden border-2 transition-all group cursor-grab active:cursor-grabbing ${
        isSelected ? "border-blue-500 shadow-md shadow-blue-100" : "border-gray-200"
      }`}
      {...attributes}
      {...listeners}
    >
      {/* 체크박스 */}
      <div
        className="absolute top-2 left-2 z-10"
        onClick={(e) => { e.stopPropagation(); onToggle(image.id); }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors cursor-pointer ${
            isSelected ? "bg-blue-500 border-blue-500" : "bg-white/80 border-gray-400"
          }`}
        >
          {isSelected && (
            <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      </div>

      {/* 순서 번호 */}
      <div className="absolute top-2 right-8 bg-black/60 text-white text-xs font-medium px-1.5 py-0.5 rounded-md z-10 select-none opacity-0 group-hover:opacity-100 transition-opacity">
        {index + 1}
      </div>

      {/* 삭제 버튼 */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(image.id); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded-full bg-black/60 hover:bg-red-500 text-white z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.dataUrl}
        alt={image.name}
        className="w-full h-auto block pointer-events-none select-none"
        loading="lazy"
        draggable={false}
      />

      {isSelected && (
        <div className="absolute inset-0 bg-blue-500/10 pointer-events-none" />
      )}

      {/* 파일명 호버 레이블 */}
      <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-xs px-2 py-1 truncate opacity-0 group-hover:opacity-100 transition-opacity select-none">
        {image.name}
      </div>
    </div>
  );
}

export default function ImageToPdf() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState<PageSize>("original");
  const [dragging, setDragging] = useState(false);
  const [generating, setGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setImages((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const addImages = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (fileArray.length === 0) return;
    const loaded = await Promise.all(fileArray.map(loadImageItem));
    setImages((prev) => [...prev, ...loaded]);
    setSelected((prev) => {
      const next = new Set(prev);
      loaded.forEach((img) => next.add(img.id));
      return next;
    });
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addImages(e.target.files);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files) addImages(e.dataTransfer.files);
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
    setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(images.map((i) => i.id)));
  const deselectAll = () => setSelected(new Set());

  const generatePdf = async (targetImages: ImageItem[]) => {
    if (targetImages.length === 0) return;
    setGenerating(true);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.create();

      for (const image of targetImages) {
        const { buffer, isJpeg } = await toEmbeddableBuffer(image);
        const embedded = isJpeg
          ? await pdfDoc.embedJpg(buffer)
          : await pdfDoc.embedPng(buffer);

        let pw: number, ph: number, ix: number, iy: number, iw: number, ih: number;

        if (pageSize === "original") {
          pw = image.width; ph = image.height;
          ix = 0; iy = 0; iw = image.width; ih = image.height;
        } else {
          pw = A4.width; ph = A4.height;
          const scale = Math.min(A4.width / image.width, A4.height / image.height);
          iw = image.width * scale; ih = image.height * scale;
          ix = (A4.width - iw) / 2; iy = (A4.height - ih) / 2;
        }

        const page = pdfDoc.addPage([pw, ph]);
        page.drawImage(embedded, { x: ix, y: iy, width: iw, height: ih });
      }

      const bytes = await pdfDoc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "output.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("PDF 생성에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setGenerating(false);
    }
  };

  const selectedImages = images.filter((img) => selected.has(img.id));

  return (
    <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
      {/* 업로드 영역 */}
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
          accept="image/*"
          multiple
          className="hidden"
          onChange={onFileChange}
        />
        <div className="flex flex-col items-center gap-3 pointer-events-none">
          <svg className="w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <div>
            {images.length > 0 ? (
              <>
                <p className="text-base font-semibold text-gray-700">{images.length}장 추가됨</p>
                <p className="text-sm text-gray-400 mt-1">클릭하거나 드롭해서 더 추가</p>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-gray-700">이미지를 드롭하거나 클릭해서 추가</p>
                <p className="text-sm text-gray-400 mt-1">PNG, JPG, WEBP 등 · 여러 장 선택 가능</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 컨트롤 */}
      {images.length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex flex-wrap items-center gap-3">
          {/* 전체 선택/해제 */}
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

          {/* 페이지 크기 */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">크기:</span>
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              {(["original", "a4"] as PageSize[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setPageSize(s)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    pageSize === s
                      ? "bg-blue-500 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {s === "original" ? "원본" : "A4"}
                </button>
              ))}
            </div>
          </div>

          <span className="text-sm text-gray-400">{selected.size}장 선택됨</span>

          <button
            onClick={() => generatePdf(selectedImages)}
            disabled={selected.size === 0 || generating}
            className={`ml-auto flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              selected.size === 0 || generating
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            {generating ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                생성 중...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                PDF 생성 ({selected.size}장)
              </>
            )}
          </button>
        </div>
      )}

      {/* 정렬 가능한 이미지 그리드 */}
      {images.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={images.map((i) => i.id)} strategy={rectSortingStrategy}>
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              {images.map((img, index) => (
                <SortableImageItem
                  key={img.id}
                  image={img}
                  index={index}
                  isSelected={selected.has(img.id)}
                  onToggle={toggleSelect}
                  onRemove={removeImage}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </main>
  );
}
