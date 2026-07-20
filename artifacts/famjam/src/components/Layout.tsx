import { Nav } from "./Nav";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col relative pb-[72px] md:pb-0" style={{ background: "var(--fj-bg)" }}>
      <Nav />
      <main className="flex-1 w-full max-w-5xl mx-auto px-0 md:px-8 md:py-8 animate-in fade-in zoom-in-95 duration-500">
        {children}
      </main>
    </div>
  );
}
