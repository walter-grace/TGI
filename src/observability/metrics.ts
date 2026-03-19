/**
 * Simple in-memory metrics for status endpoint.
 */

let queueSize = 0;
let activeCount = 0;

export const metrics = {
  setQueueSize(n: number): void {
    queueSize = n;
  },
  setActiveCount(n: number): void {
    activeCount = n;
  },
  getQueueSize(): number {
    return queueSize;
  },
  getActiveCount(): number {
    return activeCount;
  },
};
