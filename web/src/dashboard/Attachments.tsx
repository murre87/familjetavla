import { useState } from "react";
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
const isPdf = (f: AttachedFile) => /\.pdf$/i.test(f.name) || /\.pdf(\b|$)/i.test(safeDecode(f.url));
const isWord = (f: AttachedFile) => /\.docx$/i.test(f.name);
const isPicture = (f: AttachedFile) => /\.(png|jpe?g|gif|webp)$/i.test(f.name);

/** The board's file route needs the file's name (for the download and for knowing it is a Word file). */
const named = (f: AttachedFile) => (f.url.startsWith("api/school/file") ? `${f.url}&n=${encodeURIComponent(f.name)}` : f.url);
export const downloadUrl = (f: AttachedFile) => (f.url.startsWith("api/school/file") ? `${named(f)}&dl=1` : f.url);

/** Open and download: every attachment has both, whatever it is. */
export function FileButtons({ file }: { file: AttachedFile }) {
  return (
    <>
      <a className="btn small" href={named(file)} target="_blank" rel="noreferrer">
        <Icon name="link" size={18} /> Öppna
      </a>
      <a className="btn small" href={downloadUrl(file)} download={file.name}>
        <Icon name="plus" size={18} /> Ladda ner
      </a>
    </>
  );
}

/** A Word file: shown as a PDF (made by the board), or as a plain page if the board cannot make one. The original can always be downloaded. */
function WordFile({ f }: { f: AttachedFile }) {
  const [plain, setPlain] = useState(false);
  const original = (
    <a className="btn small" href={downloadUrl(f)} download={f.name}>
      <Icon name="plus" size={18} /> Original (Word)
    </a>
  );
  if (plain)
    return (
      <div className="file-card">
        <div className="pdf-bar">
          <span className="pdf-name">{f.name}</span>
          <FileButtons file={f} />
        </div>
        <iframe className="doc-frame" title={f.name} sandbox="" src={`${named(f)}&view=html`} />
      </div>
    );
  const pdfName = f.name.replace(/\.docx$/i, ".pdf");
  return <PdfView url={`${named(f)}&as=pdf`} name={pdfName} downloadHref={`${downloadUrl(f)}&as=pdf`} extra={original} onError={() => setPlain(true)} />;
}

/** The files of a school task or news: a PDF is read here, a Word file is shown as a page, a picture is shown, anything else can be opened or downloaded. */
export function Attachments({ files }: { files?: AttachedFile[] }) {
  if (!files?.length) return null;
  return (
    <div className="attachments">
      {files.map((f) =>
        isPdf(f) ? (
          <PdfView key={f.url} url={named(f)} name={f.name} downloadHref={downloadUrl(f)} />
        ) : isWord(f) ? (
          <WordFile key={f.url} f={f} />
        ) : (
          <div key={f.url} className="file-card">
            <div className="pdf-bar">
              <span className="pdf-name">{f.name}</span>
              <FileButtons file={f} />
            </div>
            {isPicture(f) ? <img className="file-img" src={named(f)} alt={f.name} loading="lazy" /> : null}
          </div>
        ),
      )}
    </div>
  );
}
