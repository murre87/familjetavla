import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { PdfView } from "../PdfView";

export interface AttachedFile {
  name: string;
  url: string;
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
const PICTURE = /\.(jpe?g|png|gif|webp|heic|svg)$/i;
export const isPdf = (f: AttachedFile) => /\.pdf$/i.test(f.name) || /\.pdf(\b|$)/i.test(safeDecode(f.url));
export const isWord = (f: AttachedFile) => /\.docx$/i.test(f.name);
/** A picture is shown in the app; a PDF, a document or a web link is a button to open it. */
export const isPicture = (f: AttachedFile) => PICTURE.test(f.name.trim()) || /^bild$/i.test(f.name.trim()) || f.url.startsWith("data:image/") || PICTURE.test(safeDecode(f.url).split(/[?#]/)[0]!);
/** The files the board itself serves (Vklass files go through its own route); other links are web addresses. */
export const isBoardFile = (f: AttachedFile) => f.url.startsWith("api/");

/** The board's file route needs the file's name (for the download and for knowing it is a Word file). */
const named = (f: AttachedFile) => (f.url.startsWith("api/school/file") ? `${f.url}&n=${encodeURIComponent(f.name)}` : f.url);
const downloadUrl = (f: AttachedFile) => (f.url.startsWith("api/school/file") ? `${named(f)}&dl=1` : f.url);

/**
 * Saves a file without leaving the board. On an iPad (a home-screen app has no back button) the share sheet is
 * used ("Spara i Filer", print, open in …); elsewhere a normal download.
 */
export async function saveFile(url: string, name: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
    const a = document.createElement("a");
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30_000);
  } catch (e) {
    // The person closing the share sheet is not an error.
    if ((e as Error).name !== "AbortError") console.warn("Kunde inte spara filen", e);
  }
}

/** A picture or file shown over the whole board with a visible "Stäng": a home-screen app has no back button. */
function FullPicture({ f, onClose }: { f: AttachedFile; onClose: () => void }) {
  return createPortal(
    <div className="pdf-overlay" role="dialog" aria-label={f.name}>
      <div className="pdf-bar">
        <span className="pdf-name">{f.name}</span>
        <button className="btn small" onClick={() => void saveFile(downloadUrl(f), f.name)}>
          <Icon name="plus" size={18} /> Ladda ner
        </button>
        <button className="btn icon" aria-label="Stäng" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="pdf-box pic-box">
        <img src={named(f)} alt={f.name} />
      </div>
    </div>,
    document.body,
  );
}

function PictureFile({ f }: { f: AttachedFile }) {
  const [big, setBig] = useState(false);
  return (
    <div className="file-card">
      <div className="pdf-bar">
        <span className="pdf-name">{f.name}</span>
        <button className="btn small" onClick={() => setBig(true)}>
          <Icon name="plus" size={18} /> Visa större
        </button>
        <button className="btn small" onClick={() => void saveFile(downloadUrl(f), f.name)}>
          <Icon name="plus" size={18} /> Ladda ner
        </button>
      </div>
      <button className="pic-thumb" onClick={() => setBig(true)} aria-label={`Visa ${f.name} större`}>
        <img className="file-img" src={named(f)} alt={f.name} loading="lazy" />
      </button>
      {big && <FullPicture f={f} onClose={() => setBig(false)} />}
    </div>
  );
}

/** A Word file: shown as a PDF (made by the board), or as a plain page if the board cannot make one. The original can always be saved. */
function WordFile({ f }: { f: AttachedFile }) {
  const [plain, setPlain] = useState(false);
  const original = (
    <button className="btn small" onClick={() => void saveFile(downloadUrl(f), f.name)}>
      <Icon name="plus" size={18} /> Original (Word)
    </button>
  );
  if (plain)
    return (
      <div className="file-card">
        <div className="pdf-bar">
          <span className="pdf-name">{f.name}</span>
          {original}
        </div>
        <iframe className="doc-frame" title={f.name} sandbox="" src={`${named(f)}&view=html`} />
      </div>
    );
  const pdfName = f.name.replace(/\.docx$/i, ".pdf");
  return <PdfView url={`${named(f)}&as=pdf`} name={pdfName} onDownload={() => void saveFile(`${downloadUrl(f)}&as=pdf`, pdfName)} extra={original} onError={() => setPlain(true)} />;
}

/** The files of a school task or news: a PDF is read here, a Word file as a PDF, a picture is shown, anything else can be saved. Nothing leaves the board. */
export function Attachments({ files }: { files?: AttachedFile[] }) {
  if (!files?.length) return null;
  return (
    <div className="attachments">
      {files.map((f) =>
        isPdf(f) ? (
          <PdfView key={f.url} url={named(f)} name={f.name} onDownload={() => void saveFile(downloadUrl(f), f.name)} />
        ) : isWord(f) ? (
          <WordFile key={f.url} f={f} />
        ) : isPicture(f) ? (
          <PictureFile key={f.url} f={f} />
        ) : (
          <div key={f.url} className="file-card">
            <div className="pdf-bar">
              <span className="pdf-name">{f.name}</span>
              <button className="btn small" onClick={() => void saveFile(downloadUrl(f), f.name)}>
                <Icon name="plus" size={18} /> Ladda ner
              </button>
            </div>
          </div>
        ),
      )}
    </div>
  );
}
