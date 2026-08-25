import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGetReunionByCode, getGetReunionByCodeQueryKey } from "@workspace/api-client-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Search } from "lucide-react";
import { saveLastReunionCode } from "../lib/lastReunion";
import { eventCodePath, isValidEventCode, normalizeEventCode } from "../lib/eventCode";

export function JoinReunion() {
  const [, setLocation] = useLocation();
  const [code, setCode] = useState("");
  const [submittedCode, setSubmittedCode] = useState("");

  const { data: reunion, isLoading, isError } = useGetReunionByCode(submittedCode, {
    query: { 
      enabled: isValidEventCode(submittedCode),
      retry: false
    , queryKey: getGetReunionByCodeQueryKey(submittedCode) }
  });

  // Valid code found — remember it and go straight to the reunion hub
  useEffect(() => {
    if (reunion) {
      saveLastReunionCode(reunion.code);
      setLocation(eventCodePath(reunion.code));
    }
  }, [reunion, setLocation]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = normalizeEventCode(code);
    if (isValidEventCode(cleanCode)) {
      setSubmittedCode(cleanCode);
    }
  };

  return (
    <div className="max-w-md mx-auto py-20 flex flex-col items-center">
      <div className="bg-secondary/10 text-secondary w-20 h-20 rounded-full flex items-center justify-center mb-8 shadow-inner">
        <Search className="w-10 h-10" />
      </div>
      
      <h1 className="font-serif text-4xl font-bold mb-4 text-center">Join a Reunion</h1>
      <p className="text-lg text-muted-foreground text-center mb-10">
        Enter the Event Code provided by your reunion organizer to RSVP and view the itinerary.
      </p>

      <form onSubmit={handleSubmit} className="w-full bg-card border shadow-sm rounded-3xl p-8">
        <div className="mb-6">
          <Input
            value={code}
            onChange={(e) => setCode(normalizeEventCode(e.target.value))}
            placeholder="e.g. FAMILY-2027"
            className="text-center font-mono text-xl sm:text-2xl py-8 tracking-widest rounded-2xl bg-muted/50 border-2 focus:border-primary focus:ring-primary uppercase placeholder:normal-case placeholder:tracking-normal placeholder:text-base sm:placeholder:text-xl"
            maxLength={32}
            autoFocus
          />
          <p className="mt-3 text-sm text-muted-foreground text-center">
            7–32 characters; include a letter, number, and one of * . _ ~ -.
          </p>
        </div>

        <Button 
          type="submit" 
          disabled={!isValidEventCode(code) || isLoading}
          className="w-full rounded-full py-6 text-lg font-bold shadow-md hover:-translate-y-1 transition-all"
        >
          {isLoading ? "Looking up..." : "Find Event"}
        </Button>

        {isError && (
          <div className="mt-6 p-4 bg-destructive/10 text-destructive-foreground border border-destructive/20 rounded-xl text-center text-sm font-medium animate-in slide-in-from-top-2">
            Event not found. Please check the Event Code and try again.
          </div>
        )}
      </form>

      {reunion && (
        <p className="mt-6 text-sm font-bold" style={{ color: "var(--fj-brand)" }}>
          Found {reunion.name} — taking you there…
        </p>
      )}
    </div>
  );
}
