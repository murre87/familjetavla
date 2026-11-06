import { textBlocks } from "../../../server/src/textblocks";

export function RichText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {textBlocks(text).map((b, i) =>
        b.kind === "table" ? (
          <table className="glossary" key={i}>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="rich-p" key={i}>
            {b.text}
          </p>
        ),
      )}
    </div>
  );
}
