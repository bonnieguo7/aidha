import type { TaskRow } from "../types/task";
import { DEFAULT_EVENT_MINUTES } from "./duration";

export const MINUTES_PER_DAY = 24 * 60;

// A block needs a length to be visible on the grid. An event uses its own
// duration when it has one and an hour otherwise (DEFAULT_EVENT_MINUTES); a
// timed task has no duration, so it reads as a short half-hour slot.
const TASK_MINUTES = 30;
// A "leave by" block shorter than this would be too thin to read or tap.
const MIN_TRAVEL_MINUTES = 15;

export function getDayBounds(date: Date): { start: Date; end: Date } {
  return {
    start: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    end: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1),
  };
}

// Where `moment` falls on the day's 24-hour grid, as minutes past midnight in
// local clock time (so it lines up with the hour labels even on a daylight-
// saving day). Moments outside the day clamp to its edges.
export function dayMinutes(moment: Date, dayStart: Date, dayEnd: Date): number {
  if (moment < dayStart) return 0;
  if (moment >= dayEnd) return MINUTES_PER_DAY;
  return moment.getHours() * 60 + moment.getMinutes();
}

export type BlockKind = "event" | "task" | "travel";

export interface DayBlock {
  id: string;
  kind: BlockKind;
  task: TaskRow;
  startMinutes: number;
  endMinutes: number;
}

// Turns a day's tasks into the blocks drawn on the grid: one block per timed
// task/event, plus a "leave by" travel block leading up to any event that has
// a computed departure time.
export function buildDayBlocks(tasks: TaskRow[], dayStart: Date, dayEnd: Date): DayBlock[] {
  const blocks: DayBlock[] = [];

  for (const task of tasks) {
    if (!task.datetime) continue;
    const start = new Date(task.datetime);
    if (Number.isNaN(start.getTime()) || start < dayStart || start >= dayEnd) continue;

    const startMinutes = dayMinutes(start, dayStart, dayEnd);
    const length = task.type === "event" ? (task.duration_minutes ?? DEFAULT_EVENT_MINUTES) : TASK_MINUTES;
    blocks.push({
      id: task.id,
      kind: task.type === "event" ? "event" : "task",
      task,
      startMinutes,
      endMinutes: Math.min(startMinutes + length, MINUTES_PER_DAY),
    });

    // Done or already past - a departure reminder for it is no longer useful.
    if (task.is_completed || !task.leaving_by) continue;
    const leaveBy = new Date(task.leaving_by);
    if (Number.isNaN(leaveBy.getTime()) || leaveBy >= start) continue;

    const travelStart = dayMinutes(leaveBy, dayStart, dayEnd);
    blocks.push({
      id: `${task.id}:travel`,
      kind: "travel",
      task,
      startMinutes: travelStart,
      endMinutes: Math.max(startMinutes, travelStart + MIN_TRAVEL_MINUTES),
    });
  }

  return blocks;
}

export interface PositionedBlock extends DayBlock {
  column: number;
  columnCount: number;
}

// Side-by-side layout for overlapping blocks, the way a calendar app does it:
// blocks that overlap (directly or through a chain of others) form a cluster,
// each takes the leftmost column free at its start, and everything in the
// cluster shares the cluster's column count as its width divisor. Blocks that
// merely touch (one ends exactly when the next starts) don't overlap.
export function layoutBlocks(blocks: DayBlock[]): PositionedBlock[] {
  const sorted = [...blocks].sort(
    (a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes
  );

  const positioned: PositionedBlock[] = [];
  let cluster: { block: DayBlock; column: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const closeCluster = () => {
    for (const { block, column } of cluster) {
      positioned.push({ ...block, column, columnCount: columnEnds.length });
    }
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const block of sorted) {
    if (cluster.length > 0 && block.startMinutes >= clusterEnd) closeCluster();

    let column = columnEnds.findIndex((end) => end <= block.startMinutes);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(block.endMinutes);
    } else {
      columnEnds[column] = block.endMinutes;
    }

    cluster.push({ block, column });
    clusterEnd = Math.max(clusterEnd, block.endMinutes);
  }
  closeCluster();

  return positioned;
}

export interface BlockGeometry {
  top: number;
  height: number;
  left: number;
  width: number;
}

// Pixel box for a positioned block inside a grid `gridWidth` wide, leaving
// `gap` pixels between neighbouring blocks.
export function blockGeometry(
  block: PositionedBlock,
  pxPerMinute: number,
  gridWidth: number,
  gap = 2
): BlockGeometry {
  const columnWidth = gridWidth / block.columnCount;
  return {
    top: block.startMinutes * pxPerMinute,
    height: Math.max((block.endMinutes - block.startMinutes) * pxPerMinute - gap, 1),
    left: block.column * columnWidth,
    width: Math.max(columnWidth - gap, 1),
  };
}
