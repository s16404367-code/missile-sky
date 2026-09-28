/**
 * Minimal typed event bus.
 *
 * Gameplay systems emit events; audio, HUD, missions and progression subscribe.
 * This keeps systems decoupled (see master plan §43).
 */

type Listener<T> = (payload: T) => void;

export class EventBus<M> {
  private listeners = new Map<keyof M, Listener<never>[]>();

  on<K extends keyof M>(event: K, fn: Listener<M[K]>): () => void {
    let arr = this.listeners.get(event);
    if (!arr) {
      arr = [];
      this.listeners.set(event, arr);
    }
    arr.push(fn as Listener<never>);
    return () => this.off(event, fn);
  }

  off<K extends keyof M>(event: K, fn: Listener<M[K]>): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const i = arr.indexOf(fn as Listener<never>);
    if (i >= 0) arr.splice(i, 1);
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    // Copy-on-iterate guards against listeners unsubscribing during emit.
    for (let i = 0; i < arr.length; i++) {
      (arr[i] as unknown as Listener<M[K]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
