import { createPreloader } from "@/lib/preloader";

/**
 * The live Preview's code, fetched once and shared.
 *
 * The panel is lazy on purpose: it pulls in the whole chat (transcript,
 * composer, markdown, sounds, haptics), and most visits to an Assistant never
 * open it. But fetching all of that on the click made the first open wait for
 * the network, a visible pause before the rail moved. So the launcher asks for
 * it early instead, when the browser is idle after arrival and again the
 * moment a pointer shows intent (hovering the collapsed rail or the Overview's
 * vignette), and by the click it is already here.
 */
export const previewPanelCode = createPreloader(() => import("./preview-panel"));
