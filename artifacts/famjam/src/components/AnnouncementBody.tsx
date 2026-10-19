import { Fragment } from "react";
import { announcementLinks, safeAnnouncementUrl } from "../lib/announcementLinks";

export function AnnouncementBody({ body }: { body: string }) {
  let offset = 0;
  const parts = announcementLinks(body).map(link => {
    const before = body.slice(offset, link.start);
    offset = link.end;
    const href = safeAnnouncementUrl(link.url);
    return <Fragment key={link.start}>{before}{href
      ? <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-inherit underline underline-offset-2 hover:decoration-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" title="Opens in a new tab">{link.label}</a>
      : body.slice(link.start, link.end)}</Fragment>;
  });
  return <>{parts}{body.slice(offset)}</>;
}
