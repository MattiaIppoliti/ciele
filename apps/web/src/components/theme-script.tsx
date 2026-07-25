// Renders a blocking inline script that sets the theme class on <html>
// before the admin shell paints, avoiding a flash of the wrong theme. Uses
// next/script's beforeInteractive strategy — a raw <script> element (even
// server-rendered) trips React 19's "script tag while rendering React
// component" warning; next/script injects it outside that path.
//
// Keep this in sync with THEME_STORAGE_KEY and the class/colorScheme logic in
// theme-provider.tsx.

import Script from "next/script";

const THEME_INIT = `(function(){try{var e=document.documentElement,t=localStorage.getItem("theme")||"system",s=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light",r="system"===t?s:t;e.classList.remove("light","dark");e.classList.add(r);e.style.colorScheme=r}catch(e){}})();`;

export function ThemeScript() {
  return (
    <Script
      id="theme-init"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: THEME_INIT }}
    />
  );
}
