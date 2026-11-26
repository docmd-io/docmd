/**
 * Load the lazy picker module once per page. The promise is kept per URL, so the picker code is
 * fetched on the first + click and reused by every later click on every comment; a failed load is
 * forgotten so the next click can try again.
 */
const loads = new Map<string, Promise<unknown>>();

export type PickerImporter = (src: string) => Promise<unknown>;

const defaultImporter: PickerImporter = (src) => import(/* @vite-ignore */ src);

export function loadPickerModule(src: string, importer: PickerImporter = defaultImporter): Promise<unknown> {
  let pending = loads.get(src);
  if (!pending) {
    pending = importer(src);
    loads.set(src, pending);
    pending.catch(() => {
      if (loads.get(src) === pending) loads.delete(src);
    });
  }
  return pending;
}

/** Test hook: forget every kept load. */
export function resetPickerLoads(): void {
  loads.clear();
}
