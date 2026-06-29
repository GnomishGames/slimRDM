import type { CSSProperties } from "react";
import type { PaneLeaf, PaneNode, PaneSplit } from "../types";

export const PANE_HEADER_H = 24;
const DIVIDER_PX = 4;
const MIN_RATIO = 0.1;

// ── Tree operations ────────────────────────────────────────

export function countLeaves(node: PaneNode): number {
  if (node.type === "leaf") return 1;
  return countLeaves(node.first) + countLeaves(node.second);
}

export function firstLeafSessionId(node: PaneNode): string {
  if (node.type === "leaf") return node.sessionId;
  return firstLeafSessionId(node.first);
}

/** Session ids of every leaf pane, in visual (first→second) order. */
export function collectLeafSessionIds(node: PaneNode): string[] {
  if (node.type === "leaf") return [node.sessionId];
  return [...collectLeafSessionIds(node.first), ...collectLeafSessionIds(node.second)];
}

export function insertSplit(
  root: PaneNode,
  targetId: string,
  direction: "vertical" | "horizontal",
  newSessionId: string
): PaneNode {
  if (root.type === "leaf") {
    if (root.sessionId !== targetId) return root;
    const newLeaf: PaneLeaf = { type: "leaf", sessionId: newSessionId };
    const split: PaneSplit = { type: "split", direction, ratio: 0.5, first: root, second: newLeaf };
    return split;
  }
  return {
    ...root,
    first: insertSplit(root.first, targetId, direction, newSessionId),
    second: insertSplit(root.second, targetId, direction, newSessionId),
  };
}

export function removeLeaf(node: PaneNode, sessionId: string): PaneNode | null {
  if (node.type === "leaf") return node.sessionId === sessionId ? null : node;
  const newFirst = removeLeaf(node.first, sessionId);
  const newSecond = removeLeaf(node.second, sessionId);
  if (newFirst === null) return newSecond;
  if (newSecond === null) return newFirst;
  return { ...node, first: newFirst, second: newSecond };
}

export function updateRatio(
  node: PaneNode,
  path: ("first" | "second")[],
  ratio: number
): PaneNode {
  if (path.length === 0) {
    if (node.type !== "split") return node;
    return { ...node, ratio: Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, ratio)) };
  }
  if (node.type !== "split") return node;
  const [step, ...rest] = path;
  return { ...node, [step]: updateRatio(node[step], rest, ratio) };
}

// ── Layout computation ─────────────────────────────────────

export interface DividerLayout {
  direction: "vertical" | "horizontal";
  path: ("first" | "second")[];
  ratio: number;
  /** Percentage width of this split node in the container (for drag math). */
  nodeW: number;
  /** Percentage height of this split node in the container (for drag math). */
  nodeH: number;
  style: CSSProperties;
}

export interface PaneLayout {
  /** Absolute CSS style for each SessionPanel (below the pane header). */
  panelStyles: Map<string, CSSProperties>;
  /** Absolute CSS style for each PaneHeader overlay. */
  headerStyles: Map<string, CSSProperties>;
  dividers: DividerLayout[];
}

/**
 * Traverses the pane tree and computes absolute CSS positions for all panels,
 * headers, and dividers. x/y/w/h are percentage values (0–100).
 */
export function computePaneLayout(root: PaneNode): PaneLayout {
  const panelStyles = new Map<string, CSSProperties>();
  const headerStyles = new Map<string, CSSProperties>();
  const dividers: DividerLayout[] = [];

  function traverse(
    node: PaneNode,
    x: number,
    y: number,
    w: number,
    h: number,
    path: ("first" | "second")[]
  ) {
    if (node.type === "leaf") {
      headerStyles.set(node.sessionId, {
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: `${w}%`,
        height: PANE_HEADER_H,
        zIndex: 5,
      });
      panelStyles.set(node.sessionId, {
        position: "absolute",
        left: `${x}%`,
        top: `calc(${y}% + ${PANE_HEADER_H}px)`,
        width: `${w}%`,
        height: `calc(${h}% - ${PANE_HEADER_H}px)`,
      });
      return;
    }

    if (node.direction === "vertical") {
      const firstW = w * node.ratio;
      const secondW = w * (1 - node.ratio);
      traverse(node.first, x, y, firstW, h, [...path, "first"]);
      traverse(node.second, x + firstW, y, secondW, h, [...path, "second"]);
      dividers.push({
        direction: "vertical",
        path,
        ratio: node.ratio,
        nodeW: w,
        nodeH: h,
        style: {
          position: "absolute",
          left: `${x + firstW}%`,
          top: `${y}%`,
          width: DIVIDER_PX,
          height: `${h}%`,
          transform: "translateX(-50%)",
          zIndex: 10,
        },
      });
    } else {
      const firstH = h * node.ratio;
      const secondH = h * (1 - node.ratio);
      traverse(node.first, x, y, w, firstH, [...path, "first"]);
      traverse(node.second, x, y + firstH, w, secondH, [...path, "second"]);
      dividers.push({
        direction: "horizontal",
        path,
        ratio: node.ratio,
        nodeW: w,
        nodeH: h,
        style: {
          position: "absolute",
          left: `${x}%`,
          top: `${y + firstH}%`,
          width: `${w}%`,
          height: DIVIDER_PX,
          transform: "translateY(-50%)",
          zIndex: 10,
        },
      });
    }
  }

  traverse(root, 0, 0, 100, 100, []);
  return { panelStyles, headerStyles, dividers };
}
