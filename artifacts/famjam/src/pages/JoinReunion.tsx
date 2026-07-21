import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGetReunionByCode, getGetReunionByCodeQueryKey } from "@workspace/api-client-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Search } from "lucide-react";
import { saveLastReunionCode } from "../lib/lastReunion";

export function JoinReunion() {
  const [, setLocation] = useLocation();
  const [code, setCode] = useState("");
  const [submittedCode, setSubmittedCode] = useState("");

  const { data: reunion, isLoading, isError, error } = useGetReunionByCode(submittedCode, {
    query: { 
      enabled: submittedCode.length === 7,
      retry: false
    , queryKey: getGetReunionByCodeQueryKey(submittedCode) }
  });

  // Valid code found — remember it and go straight to the reunion hub
  useEffect(() => {
    if (reunion) {
      saveLastReunionCode(reunion.code);
      setLocation(`/r/${reunion.code}`);
    }
  }, [reunion, setLocation]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length === 7) {
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
        Enter the 7-character code provided by your reunion organizer to RSVP and view the itinerary.
      </p>

      <form onSubmit={handleSubmit} className="w-full bg-card border shadow-sm rounded-3xl p-8">
        <div className="mb-6">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. ABCDEFG"
            className="text-center font-mono text-3xl py-8 tracking-widest rounded-2xl bg-muted/50 border-2 focus:border-primary focus:ring-primary uppercase placeholder:normal-case placeholder:tracking-normal placeholder:text-xl"
            maxLength={7}
            autoFocus
          />
        </div>

        <Button 
          type="submit" 
          disabled={code.trim().length !== 7 || isLoading}
          className="w-full rounded-full py-6 text-lg font-bold shadow-md hover:-translate-y-1 transition-all"
        >
          {isLoading ? "Looking up..." : "Find Reunion"}
        </Button>

        {isError && (
          <div className="mt-6 p-4 bg-destructive/10 text-destructive-foreground border border-destructive/20 rounded-xl text-center text-sm font-medium animate-in slide-in-from-top-2">
            Reunion not found. Please check the code and try again.
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
