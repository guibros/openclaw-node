"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Sidebar } from "./sidebar";

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 600;
const DEFAULT_SIDEBAR = 288; // w-72 = 18rem = 288px

export function ResizableLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT_SIDEBAR);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = sidebarWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [sidebarWidth]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const next = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth.current + delta));
      setSidebarWidth(next);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <div style={{ width: sidebarWidth, minWidth: MIN_SIDEBAR, maxWidth: MAX_SIDEBAR }} className="shrink-0">
        <Sidebar />
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-accent transition-colors relative group"
      >
        <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-accent/20" />
      </div>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
