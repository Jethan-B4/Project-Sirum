/** Share reads in flight and retain only the current chapter and its two neighbors. */
export function createChapterCache<T>(read: (index: number) => Promise<T>, retain: (value: T) => boolean) {
  const entries = new Map<number, Promise<T>>();
  let center = 0;

  function focus(index: number, page?: T) {
    center = index;
    if (page !== undefined && retain(page)) entries.set(index, Promise.resolve(page));
    for (const key of entries.keys()) {
      if (Math.abs(key - center) > 1) entries.delete(key);
    }
  }

  function load(index: number) {
    const cached = entries.get(index);
    if (cached) return cached;
    const pending = read(index);
    entries.set(index, pending);
    function forget() {
      if (entries.get(index) === pending) entries.delete(index);
    }
    void pending.then(value => {
      if (Math.abs(index - center) > 1 || !retain(value)) forget();
    }, forget);
    return pending;
  }

  return { focus, load };
}
