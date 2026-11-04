/** Fixed-capacity ring buffer. Index 0 is the oldest element. O(1) push, no allocation after construction. */
export class RingBuffer<T> {
  private readonly buf: (T | undefined)[];
  private head = 0;
  private size = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('RingBuffer capacity must be a positive integer');
    }
    this.buf = new Array<T | undefined>(capacity);
  }

  get length(): number {
    return this.size;
  }

  push(value: T): void {
    if (this.size < this.capacity) {
      this.buf[(this.head + this.size) % this.capacity] = value;
      this.size++;
    } else {
      this.buf[this.head] = value;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  at(index: number): T | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) return undefined;
    return this.buf[(this.head + index) % this.capacity];
  }

  last(): T | undefined {
    return this.at(this.size - 1);
  }

  clear(): void {
    this.buf.fill(undefined);
    this.head = 0;
    this.size = 0;
  }
}
