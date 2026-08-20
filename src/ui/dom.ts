export function q<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el as T;
}

export function qa<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll(selector)) as T[];
}

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/**
 * A labelled progress bar. `tone` drives the color as the value drops; `size`
 * ('big' | 'slim') drives the visual weight, so a bar you act on can carry
 * more than a bar you only glance at.
 */
export function meterHtml(label: string, value: number, max = 100, kind = '', size = ''): string {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const tone = kind || (pct < 25 ? 'low' : pct < 55 ? 'warn' : '');
  return `
    <div class="meter ${size}">
      <div class="meter-label"><span>${esc(label)}</span><span>${Math.round(value)}${max === 100 ? '%' : ` / ${max}`}</span></div>
      <div class="bar ${tone}"><i style="width:${pct}%"></i></div>
    </div>`;
}
