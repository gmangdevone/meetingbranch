import { Nav } from "./Nav";
import { useLayoutEffect, useRef } from "react";

export function Layout({ children }: { children: React.ReactNode }) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const nav = mobileNavRef.current;
    const layout = layoutRef.current;
    if (!nav || !layout) return;

    // Include safe-area padding and changes from text size or wrapped labels.
    const updateClearance = () => {
      layout.style.setProperty("--mobile-nav-height", `${nav.getBoundingClientRect().height}px`);
    };
    updateClearance();
    const observer = new ResizeObserver(updateClearance);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={layoutRef} className="min-h-[100dvh] flex flex-col relative pb-[calc(var(--mobile-nav-height,calc(72px+env(safe-area-inset-bottom,0px)))+16px)] md:pb-0" style={{ background: "var(--fj-bg)" }}>
      <Nav mobileNavRef={mobileNavRef} />
      <main className="flex-1 w-full max-w-5xl mx-auto px-0 md:px-8 md:py-8 animate-in fade-in zoom-in-95 duration-500">
        {children}
      </main>
    </div>
  );
}
