// Renders a blocking inline script that sets the theme class on <html> before
// first paint, avoiding a flash of the wrong theme.
//
// Mounted in the ROOT layout only. The root layout is above every client
// navigation boundary, so React never re-renders it on the client, that
// matters because a <script> element created during a client render is never
// executed and React 19 warns ("Encountered a script tag while rendering React
// component"). Mounting it in a nested layout, the (marketing) group's, say,
// triggers that warning on any client nav into it, and next/script's
// `beforeInteractive` strategy is likewise only supported in the root layout.
//
// Because it is global, the script itself scopes theming: auth pages and the
// published widget must stay light (see theme-provider.tsx).
//
// Keep in sync with the scoped keys and palette logic in theme-provider.tsx.

import { MARKETING_PATH_PREFIXES } from "@/lib/console-routes";

const UNTHEMED = ["/login", "/signup", "/onboarding", "/widget"];

const THEME_INIT = `(function(){try{var p=location.pathname,u=${JSON.stringify(UNTHEMED)},m=${JSON.stringify(MARKETING_PATH_PREFIXES)},e=document.documentElement;for(var i=0;i<u.length;i++){if(p===u[i]||p.indexOf(u[i]+"/")===0){delete e.dataset.appSurface;delete e.dataset.colorPalette;return}}var isMarketing=false;for(var j=0;j<m.length;j++){if(p===m[j]||p.indexOf(m[j]+"/")===0){isMarketing=true;break}}var k=isMarketing?"ciele-marketing-theme":"theme",fallback=isMarketing?"light":"system",t=localStorage.getItem(k)||fallback,s=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light",r="system"===t?s:t;e.classList.remove("light","dark");e.classList.add(r);e.style.colorScheme=r;if(isMarketing){delete e.dataset.appSurface;delete e.dataset.colorPalette}else{e.dataset.appSurface="admin";var c=localStorage.getItem("ciele-color-palette");e.dataset.colorPalette=c==="mist-blue"?c:"midnight"}}catch(e){}})();`;

export function ThemeScript() {
  return <script id="theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT }} />;
}
