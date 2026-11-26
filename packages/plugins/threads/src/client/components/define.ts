/**
 * Register a custom element unless the tag is taken, so two bundles on one page (the docmd bundle and
 * a host app's own copy of `components.js`) do not throw "already defined".
 */
export function defineOnce(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}
