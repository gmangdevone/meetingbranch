import { toParagraphs } from "../lib/homeContent";

/** Renders plain text with paragraph and line-break support. Never interprets HTML. */
export function PlainText({ text, className, paragraphClassName = "" }: { text: string; className?: string; paragraphClassName?: string }) {
  const paragraphs = toParagraphs(text);
  return (
    <div className={className}>
      {paragraphs.map((lines, i) => (
        <p key={i} className={`${paragraphClassName} ${i > 0 ? "mt-3" : ""}`}>
          {lines.map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
