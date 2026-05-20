"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Cropper from "react-easy-crop";
import { X, ZoomIn, ZoomOut, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/toast-context";
import { useFocusTrap } from "./use-focus-trap";

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  imageSrc: string;
  onCropComplete: (croppedBlob: Blob) => void;
  onClose: () => void;
}

// Utility: crop the image using canvas
async function getCroppedImg(imageSrc: string, pixelCrop: CropArea): Promise<Blob> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = reject;
    image.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext("2d")!;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob failed"));
      },
      "image/jpeg",
      0.95
    );
  });
}

export function AvatarCropModal({ imageSrc, onCropComplete, onClose }: Props) {
  const { addToast } = useToast();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<CropArea | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useFocusTrap(dialogRef, true);

  const onCropChange = useCallback((crop: { x: number; y: number }) => setCrop(crop), []);
  const onZoomChange = useCallback((zoom: number) => setZoom(zoom), []);

  const onCropAreaComplete = useCallback((_croppedArea: CropArea, croppedAreaPixels: CropArea) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    setSaving(true);
    try {
      const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels);
      onCropComplete(croppedBlob);
    } catch {
      // UX-014: canvas crop failed (e.g. tainted cross-origin image). Fall
      // back to the uncropped original so the save still completes, and tell
      // the user the photo was not cropped.
      const res = await fetch(imageSrc);
      const blob = await res.blob();
      addToast("Couldn't crop the photo. Using the original instead.", "info");
      onCropComplete(blob);
    } finally {
      // UX-014: always reset so the Apply button never gets stuck disabled
      // on the catch/fallback path.
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-[70]" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title" className="fixed inset-4 sm:inset-8 md:inset-16 lg:inset-y-16 lg:inset-x-[25%] z-[70] bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
          <h2 id="avatar-crop-title" className="text-[15px] font-bold text-gray-900 dark:text-white">Crop Profile Photo</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        {/* Crop area */}
        <div className="flex-1 relative bg-gray-900 min-h-[300px]">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={onCropChange}
            onZoomChange={onZoomChange}
            onCropComplete={onCropAreaComplete}
          />
        </div>

        {/* Controls */}
        <div className="px-5 py-4 border-t border-gray-100 dark:border-white/[0.06] shrink-0 space-y-3">
          {/* Zoom slider */}
          <div className="flex items-center gap-3">
            <ZoomOut className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 h-1.5 rounded-full appearance-none bg-gray-200 dark:bg-white/[0.1] cursor-pointer accent-orange-500"
            />
            <ZoomIn className="w-4 h-4 text-gray-400 shrink-0" />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1 h-10 rounded-lg text-[12px]">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="flex-1 h-10 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[12px] shadow-sm disabled:opacity-40">
              {saving ? "Cropping..." : <><Check className="w-3.5 h-3.5 mr-1.5" />Apply Crop</>}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
