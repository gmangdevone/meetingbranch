import type { GraduateContent } from "@workspace/api-client-react";
import { ExternalLink } from "lucide-react";
import { FONT_STACK, SPACING_PAD, safeHttpUrl } from "../../lib/graduate";

/** Renders organizer-authored blocks as plain text with inline styles derived from enums/hex only. */
export function GraduateBlocks({ content, compact }: { content: Pick<GraduateContent, "blocks" | "foreground" | "accent">; compact?: boolean }) {
  if (content.blocks.length === 0) {
    return <p className="opacity-70 italic" style={{ color: content.foreground }}>No information has been added yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {content.blocks.map((b) => {
        const size = compact ? Math.max(14, Math.round(b.size * 0.82)) : b.size;
        const style: React.CSSProperties = {
          fontFamily: FONT_STACK[b.font],
          fontSize: `${size}px`,
          fontWeight: b.weight === "bold" ? 700 : 400,
          textAlign: b.align,
          color: b.foreground || undefined,
          background: b.background || undefined,
          padding: b.background ? SPACING_PAD[b.spacing] : `${SPACING_PAD[b.spacing]} 0`,
          borderRadius: b.background ? 14 : undefined,
          maxWidth: b.width === "narrow" ? "36rem" : undefined,
          marginLeft: b.width === "narrow" && b.align !== "left" ? "auto" : undefined,
          marginRight: b.width === "narrow" && b.align !== "right" ? "auto" : undefined,
          width: "100%",
          lineHeight: b.kind === "heading" ? 1.15 : 1.6,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        };
        if (b.kind === "heading") return <h2 key={b.id} style={style} data-testid={`block-${b.id}`}>{b.text}</h2>;
        if (b.kind === "link") {
          const href = safeHttpUrl(b.url);
          return (
            <div key={b.id} style={style} data-testid={`block-${b.id}`}>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 underline underline-offset-4 decoration-2" style={{ color: b.foreground || content.accent }}>
                  {b.text || href} <ExternalLink className="w-4 h-4 shrink-0" />
                </a>
              ) : (
                <span className="opacity-60">{b.text} (link unavailable)</span>
              )}
            </div>
          );
        }
        return <p key={b.id} style={style} data-testid={`block-${b.id}`}>{b.text}</p>;
      })}
    </div>
  );
}
