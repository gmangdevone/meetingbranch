import { AdminSaveHomeContentBody } from "@workspace/api-zod";

/** Full replacement of this content group only; other event settings are untouched. */
export const homeContentInput = AdminSaveHomeContentBody.strict().transform((value) => ({
  ...value,
  welcomeHeading: value.welcomeHeading?.trim() || null,
  welcomeDescription: value.welcomeDescription?.trim() || null,
  hotelDescription: value.hotelDescription?.trim() || null,
  hotelBookingUrl: value.hotelBookingUrl?.trim() || null,
  hotelImageUrl: value.hotelImageUrl?.trim() || null,
})).superRefine((value, ctx) => {
  if (value.hotelBookingUrl) {
    try {
      const url = new URL(value.hotelBookingUrl);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    } catch {
      ctx.addIssue({ code: "custom", path: ["hotelBookingUrl"], message: "Enter a valid http:// or https:// hotel booking URL without embedded credentials." });
    }
  }
  if (value.hotelImageUrl && !/^\/objects\/[a-zA-Z0-9/_-]+$/.test(value.hotelImageUrl)) {
    ctx.addIssue({ code: "custom", path: ["hotelImageUrl"], message: "Choose an uploaded hotel image." });
  }
  if (value.hotelEnabled) {
    if (!value.hotelDescription) ctx.addIssue({ code: "custom", path: ["hotelDescription"], message: "Add a hotel description before showing the hotel section." });
    if (!value.hotelBookingUrl) ctx.addIssue({ code: "custom", path: ["hotelBookingUrl"], message: "Add a booking URL before showing the hotel section." });
  }
});
