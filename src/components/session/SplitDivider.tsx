import type { CSSProperties, RefObject } from "react";
import { useCallback } from "react";
import { useAppStore } from "../../store/appStore";

const MIN_RATIO = 0.1;

interface Props {
  direction: "vertical" | "horizontal";
  path: ("first" | "second")[];
  ratio: number;
  /** Percentage width of the split node (used to convert px delta → ratio). */
  nodeW: number;
  /** Percentage height of the split node (used to convert px delta → ratio). */
  nodeH: number;
  style: CSSProperties;
  /** Ref to session-content div — used to measure container size for drag math. */
  contentRef: RefObject<HTMLDivElement>;
}

export function SplitDivider({
  direction,
  path,
  ratio,
  nodeW,
  nodeH,
  style,
  contentRef,
}: Props) {
  const setPaneRatio = useAppStore((s) => s.setPaneRatio);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = contentRef.current;
      if (!container) return;

      const isVert = direction === "vertical";
      const startPos = isVert ? e.clientX : e.clientY;
      const containerPx = isVert ? container.offsetWidth : container.offsetHeight;
      // The node occupies nodeW% (vert) or nodeH% (horiz) of the container.
      const nodeSizePx = containerPx * (isVert ? nodeW : nodeH) / 100;
      const startRatio = ratio;

      const onMove = (ev: MouseEvent) => {
        if (nodeSizePx <= 0) return;
        const delta = (isVert ? ev.clientX : ev.clientY) - startPos;
        const newRatio = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, startRatio + delta / nodeSizePx));
        setPaneRatio(path, newRatio);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [direction, nodeW, nodeH, ratio, path, setPaneRatio, contentRef]
  );

  return (
    <div
      className={direction === "vertical" ? "pane-divider-v" : "pane-divider-h"}
      style={style}
      onMouseDown={handleMouseDown}
    />
  );
}
