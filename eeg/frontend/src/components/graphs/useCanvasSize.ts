import { useEffect, useRef, useState } from 'react';

export function useCanvasSize(fallbackWidth: number, height: number) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallbackWidth);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const update = () => {
      const next = Math.max(160, Math.floor(el.clientWidth || fallbackWidth));
      setWidth(next);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallbackWidth]);

  return { wrapRef, width, height };
}
