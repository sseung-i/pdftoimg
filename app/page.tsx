"use client";

import { useEffect, useRef, useState } from "react";
import PdfViewer from "@/components/PdfViewer";
import PdfToImage from "@/components/PdfToImage";
import ImageToPdf from "@/components/ImageToPdf";
import PdfMerge from "@/components/PdfMerge";
import PdfSplit from "@/components/PdfSplit";

type Mode = "viewer" | "pdf-to-image" | "image-to-pdf" | "merge" | "split";

const MODES: { key: Mode; label: string }[] = [
  { key: "viewer",       label: "PDF 뷰어" },
  { key: "pdf-to-image", label: "PDF → 이미지" },
  { key: "image-to-pdf", label: "이미지 → PDF" },
  { key: "merge",        label: "PDF 병합" },
  { key: "split",        label: "PDF 분할" },
];

export default function Home() {
  const [mode, setMode] = useState<Mode>("viewer");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const currentLabel = MODES.find((m) => m.key === mode)?.label ?? "";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center">
          <span className="text-base font-bold text-gray-900">PDF Tools</span>

          <div className="ml-auto relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700 transition-colors"
            >
              <span>{currentLabel}</span>
              <svg
                className={`w-4 h-4 text-gray-500 transition-transform ${menuOpen ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50">
                {MODES.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => { setMode(key); setMenuOpen(false); }}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                      mode === key
                        ? "bg-blue-50 text-blue-600 font-medium"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {mode === "viewer"       && <PdfViewer />}
      {mode === "pdf-to-image" && <PdfToImage />}
      {mode === "image-to-pdf" && <ImageToPdf />}
      {mode === "merge"        && <PdfMerge />}
      {mode === "split"        && <PdfSplit />}
    </div>
  );
}
