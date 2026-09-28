/**
 * Tiny DOM helpers shared by all UI screens.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number | boolean | undefined>,
  children?: (Node | string)[],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      if (k === 'class') node.className = String(v);
      else if (k === 'text') node.textContent = String(v);
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2), v as EventListener);
      } else node.setAttribute(k, String(v));
    }
  }
  if (children) {
    for (const c of children) {
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
}

/** Parse an HTML string into a DocumentFragment. */
export function html(str: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = str.trim();
  return tpl.content;
}

export function qs<T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T | null {
  return root.querySelector<T>(sel);
}

export function qsa<T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

/** Pointer-friendly press handler (avoids the 300ms click delay, no double-fire). */
export function onPress(node: HTMLElement, fn: (e: PointerEvent) => void): void {
  let down = false;
  node.addEventListener('pointerdown', (e) => {
    down = true;
    node.setPointerCapture?.(e.pointerId);
    node.classList.add('pressed');
  });
  node.addEventListener('pointerup', (e) => {
    node.classList.remove('pressed');
    if (down) {
      down = false;
      fn(e);
    }
  });
  node.addEventListener('pointercancel', () => {
    down = false;
    node.classList.remove('pressed');
  });
  node.addEventListener('pointerleave', () => {
    node.classList.remove('pressed');
  });
}
