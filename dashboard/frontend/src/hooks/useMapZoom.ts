'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

interface MapZoomState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_STEP = 0.15;

export function useMapZoom() {
  const [state, setState] = useState<MapZoomState>({ scale: 1, offsetX: 0, offsetY: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Use a native wheel listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setState((prev) => {
        const direction = e.deltaY < 0 ? 1 : -1;
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * (1 + direction * ZOOM_STEP)));

        if (newScale <= MIN_SCALE) {
          return { scale: 1, offsetX: 0, offsetY: 0 };
        }

        // Zoom toward cursor position
        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        const ratio = newScale / prev.scale;
        const newOffsetX = cursorX - ratio * (cursorX - prev.offsetX);
        const newOffsetY = cursorY - ratio * (cursorY - prev.offsetY);

        return { scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY };
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const onMouseDown = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
    e.preventDefault();
  }, []);

  const onMouseMove = useCallback((e: ReactMouseEvent) => {
    if (!dragging.current) return;
    e.preventDefault();
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setState((prev) => {
      if (prev.scale <= 1) return prev;
      return {
        ...prev,
        offsetX: prev.offsetX + dx,
        offsetY: prev.offsetY + dy,
      };
    });
  }, []);

  const onMouseUp = useCallback((e: ReactMouseEvent) => {
    dragging.current = false;
    (e.currentTarget as HTMLElement).style.cursor = state.scale > 1 ? 'grab' : 'default';
  }, [state.scale]);

  const onMouseLeave = useCallback(() => {
    dragging.current = false;
  }, []);

  const resetZoom = useCallback(() => {
    setState({ scale: 1, offsetX: 0, offsetY: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setState((prev) => {
      const newScale = Math.min(MAX_SCALE, prev.scale * (1 + ZOOM_STEP * 2));
      // Zoom toward center
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const ratio = newScale / prev.scale;
        return {
          scale: newScale,
          offsetX: cx - ratio * (cx - prev.offsetX),
          offsetY: cy - ratio * (cy - prev.offsetY),
        };
      }
      return { ...prev, scale: newScale };
    });
  }, []);

  const zoomOut = useCallback(() => {
    setState((prev) => {
      const newScale = Math.max(MIN_SCALE, prev.scale * (1 - ZOOM_STEP * 2));
      if (newScale <= MIN_SCALE) return { scale: 1, offsetX: 0, offsetY: 0 };
      // Zoom toward center
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const ratio = newScale / prev.scale;
        return {
          scale: newScale,
          offsetX: cx - ratio * (cx - prev.offsetX),
          offsetY: cy - ratio * (cy - prev.offsetY),
        };
      }
      return { ...prev, scale: newScale };
    });
  }, []);

  const containerProps = {
    ref: containerRef,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
    style: { cursor: state.scale > 1 ? 'grab' as const : 'default' as const },
  };

  const transformStyle = {
    transform: `translate(${state.offsetX}px, ${state.offsetY}px) scale(${state.scale})`,
    transformOrigin: '0 0',
    willChange: 'transform' as const,
  };

  return {
    scale: state.scale,
    containerProps,
    transformStyle,
    resetZoom,
    zoomIn,
    zoomOut,
  };
}
