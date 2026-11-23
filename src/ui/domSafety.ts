/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * High-Performance DOM & XSS Safety Layer
 *
 * Implements authoritative HTML, attribute, label, and CSS color sanitization
 * alongside the `safeHtml` tagged template literal and `TrustedHtml` type brand.
 *
 * Zero-dependency, pure utilities meeting sub-microsecond performance budgets (< 1 µs/call).
 */

const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
});

const HAS_HTML_SPECIAL_REGEX = /[&<>"'`]/;
const HTML_ESCAPE_REGEX = /[&<>"'`]/g;

/**
 * Safely escapes characters with special meaning in HTML text content or attributes.
 * Handles `null`, `undefined`, numbers, and objects safely.
 */
export function escapeHtml(value: unknown): string {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : String(value);
  if (!HAS_HTML_SPECIAL_REGEX.test(str)) {
    return str;
  }
  return str.replace(HTML_ESCAPE_REGEX, (ch) => HTML_ESCAPE_MAP[ch] || ch);
}

const ATTR_ESCAPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '\r': '&#13;',
  '\n': '&#10;',
});

const ATTR_ESCAPE_REGEX = /[&<>"'`\r\n\x00-\x1F\x7F]/g;

/**
 * Strict HTML attribute escaping.
 * Escapes quotes, HTML delimiters, line-breaks, and strips/escapes ASCII control characters.
 */
export function escapeAttr(value: unknown): string {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.replace(ATTR_ESCAPE_REGEX, (ch) => {
    if (ch === '\x00') return '';
    return ATTR_ESCAPE_MAP[ch] || `&#${ch.charCodeAt(0)};`;
  });
}

const HAS_CONTROL_OR_MULTI_SPACE_REGEX = /[\x00-\x1F\x7F]|\s{2,}|^\s|\s$/;
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]+/g;
const MULTI_SPACE_REGEX = /\s+/g;

/**
 * Sanitizes arbitrary user or telemetry labels (e.g. UAV callsigns, .hgt file names, CAD obstacle names):
 * 1. Strips ASCII control characters (\x00-\x1F, \x7F).
 * 2. Collapses whitespace sequences and trims leading/trailing whitespace.
 * 3. Falls back to `fallback` if empty.
 * 4. Truncates safely to `maxLen` code points.
 * 5. Escapes for safe HTML display.
 */
export function sanitizeLabel(
  value: unknown,
  maxLen: number = 64,
  fallback: string = 'UNKNOWN'
): string {
  if (value == null) return escapeHtml(fallback);
  const raw = typeof value === 'string' ? value : String(value);
  let str = raw;
  if (HAS_CONTROL_OR_MULTI_SPACE_REGEX.test(str)) {
    str = str.replace(CONTROL_CHARS_REGEX, '').replace(MULTI_SPACE_REGEX, ' ').trim();
  }
  if (str.length === 0) {
    return escapeHtml(fallback);
  }
  if (str.length > maxLen) {
    str = str.slice(0, maxLen);
  }
  return escapeHtml(str);
}

const DANGEROUS_CSS_REGEX = /[;{}<>\r\n]|url\(|expression\(|javascript:/i;
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR_REGEX = /^rgba?\(\s*(\d{1,3}%?[\s,]+){2}\d{1,3}%?(\s*[,/]\s*(0|1|0?\.\d+|\d{1,3}%))?\s*\)$/i;
const HSL_COLOR_REGEX = /^hsla?\(\s*\d{1,3}(?:deg|rad|turn)?[\s,]+\d{1,3}%[\s,]+\d{1,3}%(\s*[,/]\s*(0|1|0?\.\d+|\d{1,3}%))?\s*\)$/i;
const CSS_VAR_REGEX = /^var\(--[a-zA-Z0-9_-]+\)$/;

/**
 * Strictly sanitizes CSS color values.
 * Allows valid hex colors, rgb/rgba, hsl/hsla, and `var(--...)` tokens.
 * Rejects any candidate containing `;`, `{`, `}`, `url(...)`, `expression(...)`, or `javascript:`.
 */
export function sanitizeCssColor(value: unknown, fallback: string = '#94a3b8'): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || DANGEROUS_CSS_REGEX.test(trimmed)) {
    return fallback;
  }
  if (
    HEX_COLOR_REGEX.test(trimmed) ||
    RGB_COLOR_REGEX.test(trimmed) ||
    HSL_COLOR_REGEX.test(trimmed) ||
    CSS_VAR_REGEX.test(trimmed)
  ) {
    return trimmed;
  }
  return fallback;
}

/**
 * Brand for verified trusted static HTML fragments.
 */
export class TrustedHtml {
  private readonly _html: string;

  constructor(html: string) {
    this._html = html;
  }

  public toString(): string {
    return this._html;
  }

  public get value(): string {
    return this._html;
  }
}

/**
 * Explicitly marks a static markup string as trusted HTML.
 * Use strictly with static author-controlled markup (e.g. SVG icons or vetted structural tags).
 */
export function trustedHtml(staticMarkup: string): TrustedHtml {
  return new TrustedHtml(staticMarkup);
}

/**
 * Tagged template literal for generating safe HTML.
 * All interpolated values are automatically escaped via `escapeHtml`, unless
 * explicitly marked as `TrustedHtml` via `trustedHtml(...)`.
 */
export function safeHtml(strings: TemplateStringsArray, ...values: unknown[]): TrustedHtml {
  let result = strings[0];
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (val instanceof TrustedHtml) {
      result += val.toString();
    } else if (Array.isArray(val)) {
      result += val
        .map((item) => (item instanceof TrustedHtml ? item.toString() : escapeHtml(item)))
        .join('');
    } else {
      result += escapeHtml(val);
    }
    result += strings[i + 1];
  }
  return new TrustedHtml(result);
}

const DANGEROUS_ATTR_REGEX = /^on/i;
const URL_ATTR_NAMES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
  'poster',
]);

const CONTROL_AND_WHITESPACE_REGEX = /[\x00-\x1F\x7F\s]+/g;
const SAFE_RASTER_DATA_REGEX = /^data:image\/(?:png|jpeg|jpg|webp)(?:;charset=[^;]+)?(?:;base64)?,/i;

/**
 * Validates whether a URL or URI candidate is safe against script execution and malicious protocol injection.
 * Rejects non-strings, empty strings, protocol-relative URLs (`//...`), and unsafe schemes (`javascript:`, `vbscript:`,
 * executable `data:` types such as `text/html` or `image/svg+xml`).
 * Safely permits relative paths (`/`, `./`, `../`, `#`, `?`), `http:`, `https:`, `mailto:`, `blob:`, and safe raster image `data:` URLs.
 */
export function isSafeUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!trimmed) return false;

  // Reject protocol-relative URLs (//evil.com or \\evil.com)
  if (trimmed.startsWith('//') || trimmed.startsWith('\\\\')) {
    return false;
  }

  // Normalize string for scheme detection by stripping ASCII control characters & whitespace
  const normalized = trimmed.replace(CONTROL_AND_WHITESPACE_REGEX, '').toLowerCase();

  // Find the first delimiter character indicating scheme boundary or path start
  const firstDelimIdx = normalized.search(/[:\/?#]/);

  if (firstDelimIdx !== -1 && normalized[firstDelimIdx] === ':') {
    const scheme = normalized.slice(0, firstDelimIdx);
    if (scheme === 'https' || scheme === 'http' || scheme === 'mailto' || scheme === 'blob') {
      return true;
    }
    if (scheme === 'data') {
      return SAFE_RASTER_DATA_REGEX.test(trimmed);
    }
    // Block javascript:, vbscript:, file:, etc.
    return false;
  }

  // Relative URL or fragment
  return true;
}

/**
 * Safe DOM element factory using `document.createElement` and `textContent`.
 * Enforces strict attribute filtering:
 * 1. Disallows inline `on*` event handlers and `srcdoc`.
 * 2. Validates URL attributes (`href`, `src`, `action`, `formaction`, `xlink:href`, `poster`) via `isSafeUrl`.
 */
export function createSafeElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number | boolean | null | undefined>,
  textContent?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, val] of Object.entries(attrs)) {
      if (val === null || val === undefined) continue;
      const lowerKey = key.toLowerCase();

      // Block inline on* event handlers and srcdoc
      if (DANGEROUS_ATTR_REGEX.test(lowerKey) || lowerKey === 'srcdoc') {
        continue;
      }

      // Validate URL attributes with isSafeUrl
      if (URL_ATTR_NAMES.has(lowerKey)) {
        if (!isSafeUrl(val)) {
          continue;
        }
      }

      if (typeof val === 'boolean') {
        if (val) el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(val));
      }
    }
  }
  if (textContent !== undefined && textContent !== null) {
    el.textContent = textContent;
  }
  return el;
}
