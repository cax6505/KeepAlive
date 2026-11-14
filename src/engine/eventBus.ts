export type Unsubscribe = () => void;
export type EventListener<T> = (event: T) => void;

/** A small synchronous fan-out bus for the local replay feed. */
export class EventBus<T> {
  private listeners = new Set<EventListener<T>>();

  subscribe(listener: EventListener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: T): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  clear(): void {
    this.listeners.clear();
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}
