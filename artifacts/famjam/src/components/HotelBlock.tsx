import { BedDouble, ExternalLink } from "lucide-react";
import { HOTEL_BUTTON_LABEL, hotelVisible, safeHttpUrl } from "../lib/homeContent";
import { PlainText } from "./PlainText";

export function HotelBlock({
  content,
}: {
  content: { hotelEnabled?: boolean; hotelDescription?: string | null; hotelBookingUrl?: string | null; hotelImageUrl?: string | null };
}) {
  if (!hotelVisible(content)) return null;
  const url = safeHttpUrl(content.hotelBookingUrl)!;
  return (
    <div data-testid="section-hotel" className="mb-8 rounded-2xl border bg-muted/40 overflow-hidden">
      {content.hotelImageUrl && (
        <img
          data-testid="img-hotel"
          src={`${import.meta.env.BASE_URL}api/storage${content.hotelImageUrl}`}
          alt="Event hotel"
          className="w-full h-44 md:h-56 object-cover"
        />
      )}
      <div className="p-5 md:p-6">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">
          <BedDouble className="w-4 h-4" /> Where to Stay
        </h3>
        <PlainText text={content.hotelDescription ?? ""} className="text-foreground" />
        <a
          data-testid="link-hotel-booking"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full border-2 border-primary px-5 py-3 text-center font-bold text-primary whitespace-normal break-words hover:bg-primary hover:text-primary-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {HOTEL_BUTTON_LABEL}
          <ExternalLink className="w-4 h-4 shrink-0" />
        </a>
      </div>
    </div>
  );
}
