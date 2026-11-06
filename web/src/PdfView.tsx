import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

type PdfLib = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDoc = Awaited<ReturnType<PdfLib["getDocument"]>["promise"]>;

let lib: Promise<PdfLib> | undefined;
/** pdf.js is large: it is loaded only when someone opens a PDF. The "legacy" build also runs on older iPads. */
function loadPdf(): Promise<PdfLib> {
  lib ??= (async () => {
    const [pdf, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]);
    pdf.GlobalWorkerOptions.workerSrc = worker.default;
    return pdf;
  })();
  return lib;
}

const docs = new Map<string, Promise<PdfDoc>>();
function openDoc(url: string): Promise<PdfDoc> {
  let p = docs.get(url);
  if (!p) {
    p = loadPdf().then((pdf) => pdf.getDocument({ url }).promise);
    docs.set(url, p);
    p.catch(() => docs.delete(url));
    // A board can run for weeks: keep only the latest few documents in memory.
    if (docs.size > 6) {
      const oldest = docs.keys().next().value;
      if (oldest) {
        void docs.get(oldest)?.then((d) => (d as unknown as { destroy?: () => void }).destroy?.()).catch(() => {});
        docs.delete(oldest);
      }
    }
  }
  return p;
}

/** The page zoom of the whole board ("Storlek"): a canvas is drawn in screen pixels, the layout is measured in zoomed CSS pixels. */
const pageZoom = () => parseFloat(getComputedStyle(document.documentElement).zoom) || 1;

function Pane({ url, name, downloadHref, extra, onError, big, onZoom, onClose }: { url: string; name: string; downloadHref?: string; extra?: React.ReactNode; onError?: () => void; big?: boolean; onZoom?: () => void; onClose?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [wide, setWide] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The canvas is shown only once the page is drawn (an empty white sheet looks like a broken file).
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setDoc(null);
    setError(false);
    setPage(1);
    openDoc(url)
      .then((d) => alive && setDoc(d))
      .catch(() => {
        if (!alive) return;
        setError(true);
        onError?.();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // The area the page may fill follows the box (it changes with the screen and the board's zoom).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    if (!doc || !cv || !size.w || !size.h) return;
    let task: { cancel: () => void; promise: Promise<unknown> } | undefined;
    let alive = true;
    setReady(false);
    doc
      .getPage(page)
      .then((pg) => {
        if (!alive) return;
        const base = pg.getViewport({ scale: 1 });
        // The whole page fits the box; in "wide" mode only the width does (the box then scrolls).
        const s = wide ? size.w / base.width : Math.min(size.w / base.width, size.h / base.height);
        // Sharp on a retina screen, but a full-screen page at 2x is millions of pixels: cap it so a tablet draws it quickly (and iOS keeps the canvas).
        const cssW = base.width * s;
        const cssH = base.height * s;
        const out = Math.min((window.devicePixelRatio || 1) * pageZoom(), Math.sqrt(4_000_000 / (cssW * cssH)));
        const vp = pg.getViewport({ scale: s * out });
        cv.width = Math.floor(vp.width);
        cv.height = Math.floor(vp.height);
        cv.style.width = `${Math.floor(base.width * s)}px`;
        cv.style.height = `${Math.floor(base.height * s)}px`;
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        task = pg.render({ canvasContext: ctx, viewport: vp, canvas: cv });
        task.promise.then(() => alive && setReady(true)).catch(() => {});
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, page, size, wide]);

  const pages = doc?.numPages ?? 0;
  return (
    <div className={`pdf-pane ${big ? "big" : ""}`}>
      <div className="pdf-bar">
        <span className="pdf-name">{name}</span>
        {pages > 1 && (
          <span className="pdf-pager">
            <button className="btn icon" aria-label="Föregående sida" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <Icon name="chevronLeft" size={20} />
            </button>
            <b className="tabular">
              {page} / {pages}
            </b>
            <button className="btn icon" aria-label="Nästa sida" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
              <Icon name="chevronRight" size={20} />
            </button>
          </span>
        )}
        {big && (
          <button className="btn small" onClick={() => setWide((w) => !w)}>
            <Icon name={wide ? "minus" : "plus"} size={18} /> {wide ? "Hela sidan" : "Förstora"}
          </button>
        )}
        <a className="btn small" href={url} target="_blank" rel="noreferrer">
          <Icon name="link" size={18} /> Öppna
        </a>
        {downloadHref && (
          <a className="btn small" href={downloadHref} download={name}>
            <Icon name="plus" size={18} /> Ladda ner
          </a>
        )}
        {extra}
        {big && (
          <button className="btn icon" aria-label="Stäng" onClick={onClose}>
            <Icon name="x" />
          </button>
        )}
      </div>
      <div ref={box} className={`pdf-box ${wide ? "wide" : ""}`} onClick={!big ? onZoom : undefined} role={!big ? "button" : undefined} aria-label={!big ? `Visa ${name} större` : undefined}>
        {error ? <p className="error-text">Kunde inte visa PDF-filen. Tryck på Öppna.</p> : !doc ? <p className="muted">Hämtar…</p> : !ready ? <p className="muted">Ritar sidan…</p> : null}
        <canvas ref={canvas} hidden={!doc || error || !ready} />
      </div>
    </div>
  );
}

/** A PDF shown right in the sheet: the whole page, ‹ › between pages, and a full-screen view to read it. */
export function PdfView({ url, name, downloadHref, extra, onError }: { url: string; name: string; downloadHref?: string; extra?: React.ReactNode; onError?: () => void }) {
  const [big, setBig] = useState(false);
  return (
    <>
      <Pane url={url} name={name} downloadHref={downloadHref} extra={extra} onError={onError} onZoom={() => setBig(true)} />
      {big &&
        createPortal(
          <div className="pdf-overlay" role="dialog" aria-label={name}>
            <Pane url={url} name={name} downloadHref={downloadHref} extra={extra} big onClose={() => setBig(false)} />
          </div>,
          document.body,
        )}
    </>
  );
}
