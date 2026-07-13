import { Nav } from "./Nav";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background relative pb-[80px] md:pb-0">
      <Nav />
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 md:p-8 animate-in fade-in zoom-in-95 duration-500">
        {children}
      </main>
    </div>
  );
}
