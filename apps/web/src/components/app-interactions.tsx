"use client";

import { TextFieldMotion } from "@/components/motion/text-field-motion";
import { Toasts } from "@/components/notifications/toasts";
import { AppSquircleFilter } from "@/components/v1/skiper63";
import { CookieConsent } from "@/components/cookie-consent/cookie-consent";

/** One client boundary for ambient interactions shared by every route. */
export function AppInteractions() {
  return <><Toasts /><TextFieldMotion /><AppSquircleFilter /><CookieConsent /></>;
}
