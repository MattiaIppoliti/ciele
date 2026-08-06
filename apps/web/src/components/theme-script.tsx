// Renders a blocking inline script that sets the theme class on <html> before
// first paint, avoiding a flash of the wrong theme.
//
// Mounted in the ROOT layout only. The root layout is above every client
// navigation boundary, so React never re-renders it on the client — that
// matters because a <script> element created during a client render is never
// executed and React 19 warns ("Encountered a script tag while rendering React
// component"). Mounting it in a nested layout — the (marketing) group's, say —
// triggers that warning on any client nav into it, and next/script's
// `beforeInteractive` strategy is likewise only supported in the root layout.
//
// Because it is global, the script itself scopes theming: auth pages and the
// published widget must stay light (see theme-provider.tsx).
//
// Keep in sync with THEME_STORAGE_KEY and the class/colorScheme logic in
// theme-provider.tsx.

const UNTHEMED = ["/login", "/signup", "/onboarding", "/widget"];

const THEME_INIT = `(function(){try{var p=location.pathname,u=${JSON.stringify(UNTHEMED)};for(var i=0;i<u.length;i++){if(p===u[i]||p.indexOf(u[i]+"/")===0)return}var e=document.documentElement,t=localStorage.getItem("theme")||"system",s=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light",r="system"===t?s:t;e.classList.remove("light","dark");e.classList.add(r);e.style.colorScheme=r}catch(e){}})();`;

export function ThemeScript() {
  return <script id="theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT }} />;
}
