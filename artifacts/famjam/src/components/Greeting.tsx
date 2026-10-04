import { useProfile } from "../lib/profile";

/** First-name-only greeting. Renders nothing when signed out, loading or unnamed. */
export function Greeting({ className = "" }: { className?: string }) {
  const { greeting } = useProfile();
  if (!greeting) return null;
  return (
    <p data-testid="personal-greeting" className={`break-words ${className}`}>
      {greeting}
    </p>
  );
}
