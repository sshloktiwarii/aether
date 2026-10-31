/**
 * Offscreen Hidden Textarea DOM Shim for Native Input, Clipboard, and Mobile Focus.
 * Synchronizes screen-space coordinates with the active cursor for native IME alignment.
 */

export type KeyDataHandler = (bytes: Uint8Array) => void;
export type PasteHandler = (text: string) => void;

export class TextareaShim {
  public readonly textarea: HTMLTextAreaElement;
  private container: HTMLElement;
  private onData: KeyDataHandler;
  private onPaste: PasteHandler;

  constructor(
    container: HTMLElement,
    onData: KeyDataHandler,
    onPaste: PasteHandler
  ) {
    this.container = container;
    this.onData = onData;
    this.onPaste = onPaste;

    this.textarea = document.createElement('textarea');
    this.setupElement();
    this.bindEvents();
    this.container.appendChild(this.textarea);
  }

  private setupElement(): void {
    const s = this.textarea.style;
    s.position = 'absolute';
    s.top = '0px';
    s.left = '0px';
    s.width = '1px';
    s.height = '1px';
    s.opacity = '0';
    s.color = 'transparent';
    s.background = 'transparent';
    s.border = 'none';
    s.outline = 'none';
    s.padding = '0';
    s.margin = '0';
    s.resize = 'none';
    s.overflow = 'hidden';
    s.whiteSpace = 'nowrap';
    s.zIndex = '-1';

    this.textarea.autocomplete = 'off';
    this.textarea.setAttribute('autocorrect', 'off');
    this.textarea.autocapitalize = 'off';
    this.textarea.spellcheck = false;
    this.textarea.setAttribute('tabindex', '0');
  }

  private bindEvents(): void {
    // Focus capture on container click
    this.container.addEventListener('pointerdown', () => {
      this.focus();
    });

    this.textarea.addEventListener('keydown', (e) => this.handleKeyDown(e));
    this.textarea.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        this.onPaste(text);
      }
    });
  }

  public focus(): void {
    this.textarea.focus({ preventScroll: true });
  }

  public blur(): void {
    this.textarea.blur();
  }

  /**
   * Aligns hidden textarea to screen-space cursor pixel coordinates.
   */
  public updateCursorPosition(col: number, row: number, cellW: number, cellH: number): void {
    const x = Math.round(col * cellW);
    const y = Math.round(row * cellH);
    this.textarea.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const encoder = new TextEncoder();

    // Modifiers
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const code = e.key.toUpperCase().charCodeAt(0);
      if (code >= 65 && code <= 90) {
        // Ctrl+A = 1, Ctrl+C = 3, etc.
        e.preventDefault();
        this.onData(new Uint8Array([code - 64]));
        return;
      }
    }

    let seq: string | null = null;

    switch (e.key) {
      case 'Enter':
        seq = '\r';
        break;
      case 'Backspace':
        seq = '\x7f';
        break;
      case 'Tab':
        seq = '\t';
        break;
      case 'Escape':
        seq = '\x1b';
        break;
      case 'ArrowUp':
        seq = '\x1b[A';
        break;
      case 'ArrowDown':
        seq = '\x1b[B';
        break;
      case 'ArrowRight':
        seq = '\x1b[C';
        break;
      case 'ArrowLeft':
        seq = '\x1b[D';
        break;
      case 'Home':
        seq = '\x1b[H';
        break;
      case 'End':
        seq = '\x1b[F';
        break;
      case 'PageUp':
        seq = '\x1b[5~';
        break;
      case 'PageDown':
        seq = '\x1b[6~';
        break;
      case 'Delete':
        seq = '\x1b[3~';
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          seq = e.key;
        }
        break;
    }

    if (seq !== null) {
      e.preventDefault();
      this.onData(encoder.encode(seq));
    }
  }
}
