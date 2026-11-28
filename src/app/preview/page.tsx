import React, { Suspense } from "react";
import { PopoutPreview } from "@/components/PopoutPreview";

export default function PreviewPopoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center bg-slate-950 text-xs text-slate-400">
          プレビューを読み込んでいます...
        </div>
      }
    >
      <PopoutPreview />
    </Suspense>
  );
}
