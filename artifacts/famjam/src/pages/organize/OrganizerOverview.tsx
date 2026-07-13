import { useGetReunion, getGetReunionQueryKey } from "@workspace/api-client-react";
import { Copy, Check, Users, FileText, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "../../components/ui/button";
import { useToast } from "../../hooks/use-toast";
import { OrganizerLayout } from "./OrganizerLayout";

export function OrganizerOverview({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const { toast } = useToast();
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const { data: summary } = useGetReunion(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getGetReunionQueryKey(reunionId) }
  });

  if (!summary) return null; // Layout handles loading/errors

  const shareUrl = `${window.location.origin}/r/${summary.reunion.code}`;

  const copyCode = () => {
    navigator.clipboard.writeText(summary.reunion.code);
    setCopiedCode(true);
    toast({ title: "Code copied!" });
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    toast({ title: "Link copied!" });
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <OrganizerLayout reunionId={reunionId}>
      <div className="flex flex-col gap-6">
        <h1 className="font-serif text-3xl font-bold">Overview</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-primary text-primary-foreground rounded-3xl p-6 shadow-md relative overflow-hidden">
            <div className="absolute right-0 bottom-0 opacity-10 translate-x-1/4 translate-y-1/4">
              <Users className="w-48 h-48" />
            </div>
            <h3 className="font-medium opacity-90 mb-6">Current Headcount</h3>
            <div className="flex items-baseline gap-4 mb-2">
              <span className="text-6xl font-bold">{summary.attendeeCount}</span>
              <span className="text-xl opacity-90">People</span>
            </div>
            <p className="text-sm opacity-80 mb-6">Across {summary.registrationCount} households</p>
            <Link href={`/organize/${reunionId}/registrations`}>
              <Button variant="secondary" className="rounded-xl w-full bg-white text-primary hover:bg-white/90">
                Manage Registrations
              </Button>
            </Link>
          </div>

          <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col">
            <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground mb-4">Share Invite</h3>
            <div className="flex-1 flex flex-col justify-center">
              <div className="flex items-center justify-between bg-muted rounded-xl p-4 mb-4">
                <div>
                  <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Code</div>
                  <div className="font-mono text-2xl font-bold tracking-widest">{summary.reunion.code}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={copyCode}>
                  {copiedCode ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
                </Button>
              </div>
              <div className="flex items-center justify-between border rounded-xl p-4">
                <div className="truncate mr-4 text-sm font-medium">
                  {shareUrl}
                </div>
                <Button size="icon" variant="ghost" className="shrink-0" onClick={copyLink}>
                  {copiedLink ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <Link href={`/organize/${reunionId}/reports`} className="bg-card border shadow-sm rounded-2xl p-5 hover:border-primary/50 transition-colors group">
            <div className="bg-muted w-10 h-10 rounded-full flex items-center justify-center mb-4 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
              <FileText className="w-5 h-5" />
            </div>
            <h4 className="font-bold mb-1">Reports & Export</h4>
            <p className="text-sm text-muted-foreground flex items-center">
              T-shirt sizes, diets <ArrowRight className="w-3 h-3 ml-1 group-hover:translate-x-1 transition-transform" />
            </p>
          </Link>
        </div>
      </div>
    </OrganizerLayout>
  );
}
