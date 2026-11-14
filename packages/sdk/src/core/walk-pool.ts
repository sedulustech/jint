/**
 * A pool of walk workers: each owns its own wasm memory, so parsing runs on as many cores as the
 * pool has threads. A worker takes the next file when it finishes one (work stealing). A worker
 * that crashes or hangs is abandoned and replaced, its file is retried once in the fresh worker,
 * and a second failure marks the file like any other failed parse. The run continues.
 *
 * The result of a walk is identical to calling walkUnit in-process: the worker runs the same code
 * over the same registry value.
 *
 * The pool never awaits Worker.terminate(): on Bun a worker stuck in a wasm loop ignores it, keeps
 * its thread and keeps the process alive. A hung worker is therefore abandoned, counted, and
 * replaced; a pool that abandons MAX_ABANDONED workers stops serving and its callers walk
 * in-process.
 */

import { availableParallelism } from "node:os";
import type { GrammarRegistry } from "./grammars/grammars.ts";
import type { WalkedUnit, WalkUnitOptions } from "./rules/walk-unit.ts";
import type { Unit } from "./types.ts";
import type { WalkRequest } from "./walk-worker.ts";

declare const JINT_WALK_WORKER: string | undefined;

/** Files below this count walk in-process: worker startup costs more than the walk saves. */
export const POOL_MIN_FILES = 64;
/** The most workers a pool starts by default; more threads stop paying. */
export const POOL_MAX_WORKERS = 8;
/** Abandoned (hung or crashed) workers a pool tolerates before it stops serving walks. */
export const MAX_ABANDONED = 4;
/** How long one file may take in a worker before the worker counts as hung. */
export const FILE_TIMEOUT_MS = 60_000;
/** How long a worker may take to load before it counts as hung. */
const STARTUP_TIMEOUT_MS = 30_000;

let abandonedWorkers = 0;

/**
 * How many workers this process abandoned. A worker stuck in a wasm loop keeps the process alive
 * after the run ends; an embedder that sees a nonzero count ends the process explicitly.
 */
export function abandonedWalkWorkers(): number {
  return abandonedWorkers;
}

/** Default pool size: the cores the process may use, less one for the main thread, capped. */
export function defaultPoolSize(): number {
  return Math.max(1, Math.min(POOL_MAX_WORKERS, availableParallelism() - 1));
}

export function walkWorkerUrl(): string {
  return typeof JINT_WALK_WORKER !== "undefined"
    ? JINT_WALK_WORKER
    : new URL("./walk-worker.ts", import.meta.url).href;
}

export interface WalkPoolOptions {
  readonly size?: number;
  /** Per-file limit before a worker counts as hung. */
  readonly fileTimeoutMs?: number;
  /** Abandoned workers tolerated before the pool stops serving. */
  readonly maxAbandoned?: number;
  /** The worker module; defaults to the walk worker. */
  readonly workerUrl?: string;
}

/** Thrown by walk() once the pool abandoned too many workers: the caller walks in-process. */
export class WalkPoolBroken extends Error {
  constructor() {
    super("walk workers keep failing");
    this.name = "WalkPoolBroken";
  }
}

interface Task {
  readonly unit: Unit;
  readonly options: Omit<WalkUnitOptions, "registry">;
  readonly resolve: (walked: WalkedUnit) => void;
  readonly reject: (error: Error) => void;
  attempts: number;
}

/** What a slot reports to its pool. */
interface SlotEvents {
  ready(slot: WorkerSlot): void;
  walked(slot: WorkerSlot, walked: WalkedUnit): void;
  failed(slot: WorkerSlot, reason: string, cause?: unknown): void;
}

type WorkerReply = { t: "ready" } | { t: "walked"; id: number; walked: WalkedUnit };

/** One worker thread with the file it is walking and the timer that bounds the walk. */
class WorkerSlot {
  ready = false;
  task: Task | null = null;
  retired = false;
  private jobId = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly worker: Worker;

  constructor(
    url: string,
    /** The file a failed predecessor left: this worker walks it first, no other does. */
    public retry: Task | null,
    private readonly registry: GrammarRegistry,
    private readonly events: SlotEvents,
  ) {
    this.worker = new Worker(url);
    this.arm(STARTUP_TIMEOUT_MS, `worker did not start within ${STARTUP_TIMEOUT_MS}ms`);
    this.worker.addEventListener("message", (event: MessageEvent<WorkerReply>) =>
      this.onReply(event.data),
    );
    this.worker.addEventListener("error", (event: Event) => {
      event.preventDefault();
      this.fail(`worker failed: ${(event as ErrorEvent).message}`, (event as ErrorEvent).error);
    });
    this.worker.addEventListener("messageerror", () => this.fail("worker reply was unreadable"));
    this.worker.addEventListener("close", () => this.fail("worker exited"));
  }

  assign(id: number, task: Task, timeoutMs: number): void {
    this.task = task;
    this.jobId = id;
    this.arm(timeoutMs, `worker did not finish the file within ${timeoutMs}ms`);
    this.worker.postMessage({
      t: "walk",
      id,
      unit: task.unit,
      options: task.options,
    } satisfies WalkRequest);
  }

  /** Stop listening and ask the worker to end; the ask is never awaited. */
  retire(): void {
    this.retired = true;
    this.disarm();
    try {
      this.worker.terminate();
      (this.worker as Worker & { unref(): void }).unref();
    } catch {
      /* a worker that cannot be told to stop is abandoned either way */
    }
  }

  private onReply(reply: WorkerReply): void {
    if (this.retired) return;
    if (reply.t === "ready") {
      this.disarm();
      this.ready = true;
      this.worker.postMessage({ t: "init", registry: this.registry } satisfies WalkRequest);
      this.events.ready(this);
      return;
    }
    if (reply.id !== this.jobId) return;
    this.disarm();
    this.events.walked(this, reply.walked);
  }

  private arm(ms: number, reason: string): void {
    this.timer = setTimeout(() => this.fail(reason), ms);
  }

  private disarm(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private fail(reason: string, cause?: unknown): void {
    if (!this.retired) this.events.failed(this, reason, cause);
  }
}

export class WalkPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: Task[] = [];
  private nextId = 0;
  private closed = false;
  private abandoned = 0;
  private readonly size: number;
  private readonly fileTimeoutMs: number;
  private readonly maxAbandoned: number;
  private readonly workerUrl: string;
  private readonly events: SlotEvents = {
    ready: () => this.pump(),
    walked: (slot, walked) => {
      const task = slot.task;
      slot.task = null;
      task?.resolve(walked);
      this.pump();
    },
    failed: (slot, reason, cause) => this.replace(slot, reason, cause),
  };

  constructor(
    private readonly registry: GrammarRegistry,
    options: WalkPoolOptions = {},
  ) {
    this.size = Math.max(1, options.size ?? defaultPoolSize());
    this.fileTimeoutMs = options.fileTimeoutMs ?? FILE_TIMEOUT_MS;
    this.maxAbandoned = options.maxAbandoned ?? MAX_ABANDONED;
    this.workerUrl = options.workerUrl ?? walkWorkerUrl();
  }

  /** Workers this pool abandoned (hung past the timeout, or crashed). */
  get abandonedCount(): number {
    return this.abandoned;
  }

  walk(unit: Unit, options: Omit<WalkUnitOptions, "registry"> = {}): Promise<WalkedUnit> {
    if (this.closed) return Promise.reject(new Error("walk pool is closed"));
    if (this.broken()) return Promise.reject(new WalkPoolBroken());
    return new Promise((resolve, reject) => {
      this.queue.push({ unit, options, resolve, reject, attempts: 0 });
      const busy = this.slots.filter((slot) => slot.task !== null).length;
      while (this.slots.length < Math.min(this.size, this.queue.length + busy)) {
        this.slots.push(this.spawn(null));
      }
      this.pump();
    });
  }

  /** Stop every worker and settle pending walks. Returns at once: it never awaits a terminate. */
  close(): void {
    this.closed = true;
    this.settleAll(() => new Error("walk pool closed before the file was walked"));
  }

  private broken(): boolean {
    return this.abandoned > this.maxAbandoned;
  }

  private spawn(retry: Task | null): WorkerSlot {
    return new WorkerSlot(this.workerUrl, retry, this.registry, this.events);
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (!slot.ready || slot.task !== null) continue;
      const task = slot.retry ?? this.queue.shift();
      if (task === undefined) continue;
      slot.retry = null;
      slot.assign(this.nextId++, task, this.fileTimeoutMs);
    }
  }

  /** A worker died or hung: abandon it, start its replacement, retry its file once there. */
  private replace(slot: WorkerSlot, reason: string, cause?: unknown): void {
    if (this.closed) return;
    const task = slot.task ?? slot.retry;
    slot.retire();
    this.abandoned++;
    abandonedWorkers++;
    const index = this.slots.indexOf(slot);
    let retry: Task | null = null;
    if (task !== null && ++task.attempts >= 2) {
      task.resolve(failedWalk(reason, cause));
    } else {
      retry = task;
    }
    if (this.broken()) {
      retry?.reject(new WalkPoolBroken());
      this.slots.splice(index, 1);
      this.settleAll(() => new WalkPoolBroken());
      return;
    }
    this.slots[index] = this.spawn(retry);
  }

  /** Retire every worker, then settle the files still waiting or in flight. */
  private settleAll(error: () => Error): void {
    for (const slot of this.slots) {
      slot.retire();
      slot.task?.reject(error());
      slot.retry?.reject(error());
      slot.task = null;
      slot.retry = null;
    }
    this.slots.length = 0;
    for (const task of this.queue.splice(0)) task.reject(error());
  }
}

/** A file no worker could walk: the same shape a failed parse has in-process. */
function failedWalk(reason: string, cause: unknown): WalkedUnit {
  return { inventory: [], failed: "parse failed", failedCause: new Error(reason, { cause }) };
}
