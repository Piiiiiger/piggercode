import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The page the phone's terminal runs, executed in jsdom. The embedded bundle's contract is the global it sets: here
 * the app's real wheel turns (compiled into the page, as the bundle carries them) next to a stand-in for xterm 5.5
 * that records what the page asks of it. Like xterm, the stand-in gives a wheel event to the custom wheel handler
 * first and, while the program takes the mouse, sends one wheel report for each event the handler lets through.
 */
const WHEEL_TURNS_JS = buildSync({
    entryPoints: [fileURLToPath(new URL('../wheelTurns.ts', import.meta.url))],
    bundle: true,
    format: 'iife',
    globalName: 'PIGGERCODE_TEST_WHEEL_TURNS',
    platform: 'browser',
    write: false,
}).outputFiles[0]!.text;

const ROW_HEIGHT_PX = 18;

const FAKE_XTERM_BUNDLE = `${WHEEL_TURNS_JS}
globalThis.PIGGERCODE_XTERM_WEBVIEW = (() => {
  class Unicode11Addon {}
  class WebglAddon {
    constructor() {
      if (globalThis.__noWebgl) throw new Error('no WebGL context');
      this.disposed = false;
      globalThis.__webgl = this;
    }
    onContextLoss(listener) { this.loseContext = listener; }
    dispose() { this.disposed = true; }
  }
  class FitAddon { fit() {} }
  class Terminal {
    constructor(options) {
      this.options = options;
      this.cols = 40;
      this.rows = 20;
      this.modes = { mouseTrackingMode: 'vt200' };
      this.unicode = { activeVersion: '6' };
      this.addons = [];
      this.focusCount = 0;
      this.wheelEvents = 0;
      this.reports = [];
      globalThis.__term = this;
    }
    loadAddon(addon) { this.addons.push(addon.constructor.name); }
    attachCustomWheelEventHandler(handler) { this.wheelHandler = handler; }
    open(root) {
      this.element = document.createElement('div');
      const screen = document.createElement('div');
      screen.className = 'xterm-screen';
      screen.getBoundingClientRect = () => ({ height: this.rows * ${ROW_HEIGHT_PX}, width: this.cols * 9, top: 0, left: 0 });
      this.element.appendChild(screen);
      root.appendChild(this.element);
      this.element.addEventListener('wheel', (event) => {
        this.wheelEvents += 1;
        if (this.wheelHandler && this.wheelHandler(event) === false) return;
        if (this.modes.mouseTrackingMode !== 'none') this.reports.push(event.deltaY < 0 ? 'up' : 'down');
      });
    }
    focus() { this.focusCount += 1; }
    onData() {}
    write(_data, done) { if (done) done(); }
    reset() {}
    clear() {}
    resize() {}
    dispose() {}
  }
  return {
    Terminal,
    FitAddon,
    Unicode11Addon,
    WebglAddon,
    createXtermWheelTurnReporter: PIGGERCODE_TEST_WHEEL_TURNS.createXtermWheelTurnReporter,
    programTakesWheel: PIGGERCODE_TEST_WHEEL_TURNS.programTakesWheel,
  };
})();
`;

type FakeTerminal = {
    options: Record<string, unknown>;
    modes: { mouseTrackingMode: string };
    unicode: { activeVersion: string };
    addons: string[];
    focusCount: number;
    wheelEvents: number;
    reports: Array<'up' | 'down'>;
};

const doms: JSDOM[] = [];
afterEach(() => {
    for (const dom of doms.splice(0)) dom.window.close();
    vi.resetModules();
    vi.doUnmock('./xtermWebViewAssets.generated');
});

type PageWindow = { ReactNativeWebView: unknown; __noWebgl?: boolean; __term?: FakeTerminal; __webgl?: { loseContext: () => void; disposed: boolean } };

async function openTerminalPage(options: Readonly<{ webgl?: boolean }> = {}): Promise<Readonly<{ dom: JSDOM; page: PageWindow; term: FakeTerminal }>> {
    vi.resetModules();
    vi.doMock('./xtermWebViewAssets.generated', () => ({
        XTERM_WEBVIEW_BUNDLE_JS: FAKE_XTERM_BUNDLE,
        XTERM_WEBVIEW_CSS: '',
    }));
    const { buildXtermWebViewHtml } = await import('./xtermWebViewHtml');
    const html = buildXtermWebViewHtml({
        theme: { backgroundColor: '#000', textColor: '#fff', cursorColor: '#fff', selectionBackgroundColor: '#222', isDark: true },
        fontSizePx: 14,
        lineHeightPx: 18,
        maxChunkBytes: 64_000,
        allowCdnFallback: false,
    });
    // jsdom runs no module scripts, so the page's scripts are run by hand, in their order.
    const scripts = [...html.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
    const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), { runScripts: 'outside-only', pretendToBeVisual: true });
    doms.push(dom);
    const page = dom.window as unknown as PageWindow;
    page.ReactNativeWebView = { postMessage: () => {} };
    page.__noWebgl = options.webgl === false;
    for (const script of scripts) dom.window.eval(script);
    await vi.waitFor(() => expect(page.__term?.focusCount).toBeDefined());
    return { dom, page, term: page.__term! };
}

/** One finger at a height, as the WebView delivers it (no finger for `touchend`). */
function touch(dom: JSDOM, type: 'touchstart' | 'touchmove' | 'touchend', clientY?: number): Event {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: clientY === undefined ? [] : [{ clientX: 40, clientY }] });
    dom.window.document.getElementById('root')!.dispatchEvent(event);
    return event;
}

describe('the phone terminal page', () => {
    it('counts character widths the way tmux and the CLIs do (Unicode 11)', async () => {
        const { term } = await openTerminalPage();

        expect(term.options.allowProposedApi).toBe(true);
        expect(term.addons).toContain('Unicode11Addon');
        expect(term.unicode.activeVersion).toBe('11');
    });

    it("draws with WebGL as the desktop does, and with xterm's DOM renderer once the phone takes the context back", async () => {
        const { page, term } = await openTerminalPage();
        expect(term.addons).toContain('WebglAddon');

        page.__webgl!.loseContext();
        expect(page.__webgl!.disposed).toBe(true);
    });

    it('opens without WebGL, drawn by xterm\'s DOM renderer', async () => {
        const { dom, term } = await openTerminalPage({ webgl: false });
        expect(term.addons).not.toContain('WebglAddon');

        touch(dom, 'touchstart', 300);
        touch(dom, 'touchend');
        expect(term.focusCount).toBeGreaterThan(0);
    });

    it('moves the scroll-back of a program that takes the mouse (tmux) one line per line the finger moved', async () => {
        const { dom, term } = await openTerminalPage();

        // Finger down three rows: three lines further back.
        touch(dom, 'touchstart', 300);
        const move = touch(dom, 'touchmove', 300 + ROW_HEIGHT_PX * 3);
        expect(term.reports).toEqual(['up', 'up', 'up']);
        expect(move.defaultPrevented).toBe(true);

        // Half a row moves nothing yet; the rest of that row does.
        touch(dom, 'touchmove', 354 + ROW_HEIGHT_PX / 2);
        expect(term.reports).toHaveLength(3);
        touch(dom, 'touchmove', 354 + ROW_HEIGHT_PX);
        expect(term.reports).toHaveLength(4);
        touch(dom, 'touchend');

        // Finger up two rows: two lines forward.
        touch(dom, 'touchstart', 300);
        touch(dom, 'touchmove', 300 - ROW_HEIGHT_PX * 2);
        touch(dom, 'touchend');
        expect(term.reports.slice(4)).toEqual(['down', 'down']);
    });

    it("leaves a swipe to xterm's own scrolling when no program takes the mouse", async () => {
        const { dom, term } = await openTerminalPage();
        term.modes.mouseTrackingMode = 'none';

        touch(dom, 'touchstart', 300);
        const move = touch(dom, 'touchmove', 300 + ROW_HEIGHT_PX * 3);
        touch(dom, 'touchend');

        expect(term.wheelEvents).toBe(0);
        expect(move.defaultPrevented).toBe(false);
    });

    it('opens the keyboard on a tap, and not on a swipe', async () => {
        const { dom, term } = await openTerminalPage();

        const beforeTap = term.focusCount;
        touch(dom, 'touchstart', 300);
        touch(dom, 'touchend');
        expect(term.focusCount).toBe(beforeTap + 1);

        const beforeSwipe = term.focusCount;
        touch(dom, 'touchstart', 300);
        touch(dom, 'touchmove', 340);
        touch(dom, 'touchend');
        expect(term.focusCount).toBe(beforeSwipe);
    });
});
