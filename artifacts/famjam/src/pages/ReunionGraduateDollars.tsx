import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetReunionByCode, getGetReunionByCodeQueryKey,
  useGetGraduatePage, getGetGraduatePageQueryKey,
  useSubmitGraduateApplication,
  useGetMyGraduateApplications, getGetMyGraduateApplicationsQueryKey,
} from "@workspace/api-client-react";
import type { GraduateQuestion, GraduateSubmission, GraduateContent } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ArrowLeft, CheckCircle2, GraduationCap, Lock, Plus, RefreshCw, X } from "lucide-react";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { GraduateBlocks } from "../components/graduate/GraduateBlocks";
import { eventCodePath } from "../lib/eventCode";
import { apiMessage, apiStatus, cashAppError, safeHttpUrl, useDocumentTitle, zelleError } from "../lib/graduate";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ReunionGraduateDollars({ params }: { params: { code: string } }) {
  const code = params.code?.toUpperCase();
  // Client-side navigation otherwise retains the event home's scroll position.
  // Only reset on entry/event changes, never while filling out the application.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [code]);
  const reunionQ = useGetReunionByCode(code, { query: { enabled: !!code, retry: false, queryKey: getGetReunionByCodeQueryKey(code) } });
  const reunion = reunionQ.data;
  const rid = reunion?.id ?? 0;
  const pageQ = useGetGraduatePage(rid, { query: { enabled: !!rid, queryKey: getGetGraduatePageQueryKey(rid) } });
  useDocumentTitle(reunion ? `Graduate Dollars · ${reunion.name}` : "Graduate Dollars");
  const mineQ = useGetMyGraduateApplications(rid, { query: { enabled: !!rid && !!pageQ.data?.visible, queryKey: getGetMyGraduateApplicationsQueryKey(rid) } });

  if (reunionQ.isLoading || (rid && pageQ.isLoading)) {
    return (
      <div className="max-w-3xl mx-auto py-10 flex flex-col gap-6">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <Skeleton className="h-72 rounded-3xl" />
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    );
  }
  if (reunionQ.isError || !reunion) {
    return <Notice title="Event not found" body="We couldn't find this event code." />;
  }
  if (pageQ.isError) {
    return <Notice title="Couldn't load Graduate Dollars" body={apiMessage(pageQ.error, "Something went wrong loading this page.")} onRetry={() => pageQ.refetch()} back={eventCodePath(reunion.code)} />;
  }
  const page = pageQ.data;
  if (!page?.visible || !page.content) {
    return <Notice title="Not available" body="Graduate Dollars isn't open for this event right now." back={eventCodePath(reunion.code)} />;
  }
  const content = page.content;

  return (
    <div className="max-w-3xl mx-auto pb-16 flex flex-col gap-8 animate-in fade-in duration-500">
      <Link href={eventCodePath(reunion.code)} className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground self-start" data-testid="link-back-event">
        <ArrowLeft className="w-4 h-4" /> {reunion.name}
      </Link>

      <section className="rounded-[2rem] overflow-hidden shadow-xl border" style={{ background: content.background, color: content.foreground }}>
        <div className="px-6 md:px-12 pt-8 pb-3 flex items-center gap-3" style={{ borderBottom: `3px solid ${content.accent}` }}>
          <GraduationCap className="w-7 h-7" style={{ color: content.accent }} />
          <h1 className="text-xs font-bold uppercase tracking-[0.25em] opacity-80">Graduate Dollars<span className="sr-only"> · {reunion.name}</span></h1>
        </div>
        <div className="px-6 md:px-12 py-8">
          <GraduateBlocks content={content} />
        </div>
      </section>

      <MyApplications q={mineQ} />

      {page.open ? (
        <ApplicationForm key={rid} reunionId={rid} content={content} />
      ) : (
        <div className="bg-card border rounded-3xl p-8 flex items-start gap-4" data-testid="status-applications-closed">
          <div className="w-11 h-11 rounded-2xl bg-muted flex items-center justify-center shrink-0"><Lock className="w-5 h-5 text-muted-foreground" /></div>
          <div>
            <h2 className="font-serif text-2xl font-bold">Applications are closed</h2>
            <p className="text-muted-foreground mt-1">The organizers aren't accepting applications right now. Check back here, or watch the event announcements.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Notice({ title, body, onRetry, back }: { title: string; body: string; onRetry?: () => void; back?: string }) {
  return (
    <div className="max-w-xl mx-auto py-20 text-center flex flex-col items-center gap-4">
      <GraduationCap className="w-12 h-12 text-muted-foreground" />
      <h1 className="font-serif text-4xl font-bold">{title}</h1>
      <p className="text-muted-foreground text-lg">{body}</p>
      <div className="flex gap-3">
        {onRetry && <Button onClick={onRetry} className="rounded-full" data-testid="button-retry"><RefreshCw className="w-4 h-4 mr-2" />Try again</Button>}
        {back && <Link href={back} className="text-primary font-bold hover:underline py-2">Back to event</Link>}
      </div>
    </div>
  );
}

function MyApplications({ q }: { q: ReturnType<typeof useGetMyGraduateApplications<GraduateSubmission[]>> }) {
  if (q.isLoading) return <Skeleton className="h-24 rounded-3xl" />;
  if (q.isError) {
    return (
      <div className="bg-card border rounded-3xl p-5 flex items-center justify-between gap-4 text-sm">
        <span className="text-muted-foreground">Couldn't load your past applications.</span>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => q.refetch()}>Retry</Button>
      </div>
    );
  }
  const list = q.data ?? [];
  if (list.length === 0) return null;
  return (
    <section className="bg-card border rounded-3xl p-6 md:p-8" data-testid="section-my-applications">
      <h2 className="font-serif text-2xl font-bold mb-1">Your applications</h2>
      <p className="text-sm text-muted-foreground mb-5">Only you and the reviewing organizers can see these. Submitted applications can't be edited.</p>
      <div className="flex flex-col gap-3">
        {list.map((s) => (
          <details key={s.id} className="group border rounded-2xl px-5 py-4 bg-muted/30" data-testid={`card-my-application-${s.id}`}>
            <summary className="cursor-pointer flex items-center justify-between gap-3 font-bold list-none">
              <span>Saved {format(new Date(s.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
              <span className="text-xs font-bold uppercase tracking-wide text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />Received</span>
            </summary>
            <dl className="mt-4 grid gap-3 text-sm">
              {s.answers.map((a) => (
                <div key={a.questionId}>
                  <dt className="font-bold">{a.label}</dt>
                  <dd className="text-muted-foreground whitespace-pre-wrap break-words">{a.value || "Left blank"}</dd>
                </div>
              ))}
              {s.links.length > 0 && (
                <div><dt className="font-bold">Profile links</dt>
                  <dd className="text-muted-foreground break-all">{s.links.map((l, i) => <div key={i}>{l.label}: {l.url}</div>)}</dd>
                </div>
              )}
            </dl>
          </details>
        ))}
      </div>
    </section>
  );
}

type LinkRow = { label: string; url: string };

function ApplicationForm({ reunionId, content }: { reunionId: number; content: GraduateContent }) {
  const qc = useQueryClient();
  const submit = useSubmitGraduateApplication();
  const requestIdRef = useRef<string>(crypto.randomUUID());
  const inFlight = useRef(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [zelle, setZelle] = useState("");
  const [cashApp, setCashApp] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState<GraduateSubmission | null>(null);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Your name is required.";
    if (!EMAIL_RE.test(email.trim())) e.email = "Enter a valid email address.";
    content.questions.forEach((q) => {
      const v = (answers[q.id] ?? "").trim();
      if (q.required && !v) e[q.id] = "This answer is required.";
      else if (q.kind === "url" && v && !safeHttpUrl(v)) e[q.id] = "Enter a full http(s) link.";
    });
    const ze = zelleError(zelle); if (ze) e.zelle = ze;
    const ce = cashAppError(cashApp); if (ce) e.cashApp = ce;
    links.forEach((l, i) => {
      if (!l.label.trim() && !l.url.trim()) return;
      if (!l.label.trim()) e[`link-label-${i}`] = "Add a label.";
      if (!safeHttpUrl(l.url)) e[`link-url-${i}`] = "Enter a full http(s) link.";
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (inFlight.current || submit.isPending) return;
    setServerError(null);
    if (!validate()) return;
    inFlight.current = true;
    submit.mutate(
      {
        reunionId,
        data: {
          requestId: requestIdRef.current,
          revision: content.revision,
          name: name.trim(),
          email: email.trim(),
          zelle: zelle.trim(),
          cashApp: cashApp.trim(),
          answers: content.questions.map((q) => ({ questionId: q.id, value: (answers[q.id] ?? "").trim() })),
          links: links.filter((l) => l.label.trim() || l.url.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
        },
      },
      {
        onSuccess: (s) => {
          setSaved(s);
          requestIdRef.current = crypto.randomUUID();
          qc.invalidateQueries({ queryKey: getGetMyGraduateApplicationsQueryKey(reunionId) });
        },
        onError: (err) => {
          const st = apiStatus(err);
          if (st === 409) {
            setServerError("The organizers just updated this form. Review the questions below and submit again.");
            requestIdRef.current = crypto.randomUUID();
            qc.invalidateQueries({ queryKey: getGetGraduatePageQueryKey(reunionId) });
          } else if (st === 503) {
            setServerError(apiMessage(err, "Applications can't be received right now because the organizers' recipient isn't set up. Your answers are still here; try again later."));
          } else if (st === 403 || st === 404) {
            setServerError(apiMessage(err, "Applications are not being accepted right now."));
            qc.invalidateQueries({ queryKey: getGetGraduatePageQueryKey(reunionId) });
          } else {
            setServerError(apiMessage(err, "Your application could not be saved. Your answers are still here; try again."));
          }
        },
        onSettled: () => { inFlight.current = false; },
      },
    );
  };

  if (saved) {
    return (
      <section className="bg-emerald-50 border border-emerald-200 rounded-3xl p-8 text-center flex flex-col items-center gap-3" data-testid="status-application-saved">
        <CheckCircle2 className="w-12 h-12 text-emerald-700" />
        <h2 className="font-serif text-3xl font-bold text-emerald-950">Application saved</h2>
        <p className="text-emerald-900 max-w-md">Your application was received on {format(new Date(saved.createdAt), "MMM d 'at' h:mm a")}. The organizers will review it and reach out at {saved.email}.</p>
        <Button variant="outline" className="rounded-full mt-2" onClick={() => { setSaved(null); setAnswers({}); setLinks([]); }} data-testid="button-new-application">Start another application</Button>
      </section>
    );
  }

  const busy = submit.isPending;
  return (
    <form onSubmit={onSubmit} noValidate className="bg-card border shadow-sm rounded-3xl p-6 md:p-10 flex flex-col gap-7" data-testid="form-graduate-application">
      <div>
        <h2 className="font-serif text-3xl font-bold">Apply</h2>
        <p className="text-muted-foreground mt-1">Organizers review every application by hand. Your answers are private to them.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <Field id="name" label="Your name" required error={errors.name}>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} data-testid="input-name" />
        </Field>
        <Field id="email" label="Contact email" required error={errors.email}>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} data-testid="input-email" />
        </Field>
      </div>

      {content.questions.map((q) => (
        <QuestionField key={q.id} q={q} value={answers[q.id] ?? ""} error={errors[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
      ))}

      <fieldset className="flex flex-col gap-3">
        <legend className="font-bold mb-1">YouTube or social profiles <span className="text-muted-foreground font-normal text-sm">optional</span></legend>
        {links.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] sm:grid-cols-[10rem_1fr_auto] gap-2 items-start">
            <div className="col-span-1">
              <Input placeholder="Label" value={l.label} maxLength={100} onChange={(e) => setLinks((ls) => ls.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} data-testid={`input-link-label-${i}`} />
              {errors[`link-label-${i}`] && <p className="text-xs text-destructive mt-1">{errors[`link-label-${i}`]}</p>}
            </div>
            <div className="col-span-1 order-3 sm:order-none col-start-1 sm:col-start-auto">
              <Input placeholder="https://" value={l.url} maxLength={2000} onChange={(e) => setLinks((ls) => ls.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} data-testid={`input-link-url-${i}`} />
              {errors[`link-url-${i}`] && <p className="text-xs text-destructive mt-1">{errors[`link-url-${i}`]}</p>}
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove link" data-testid={`button-remove-link-${i}`}><X className="w-4 h-4" /></Button>
          </div>
        ))}
        {links.length < 10 && (
          <Button type="button" variant="outline" size="sm" className="rounded-full self-start" onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])} data-testid="button-add-link"><Plus className="w-4 h-4 mr-1" />Add a link</Button>
        )}
      </fieldset>

      <fieldset className="rounded-2xl border border-dashed p-5 flex flex-col gap-4 bg-muted/30">
        <legend className="font-bold px-2">Payout details <span className="text-muted-foreground font-normal text-sm">optional, reference only</span></legend>
        <p className="text-sm text-muted-foreground -mt-1">This app never sends or requests money. These details are only shared with the reviewing organizer for their records.</p>
        <div className="grid md:grid-cols-2 gap-4">
          <Field id="zelle" label="Zelle email or phone" error={errors.zelle}><Input id="zelle" value={zelle} maxLength={254} onChange={(e) => setZelle(e.target.value)} data-testid="input-zelle" /></Field>
          <Field id="cashapp" label="Cash App tag" error={errors.cashApp}><Input id="cashapp" placeholder="$yourtag" value={cashApp} maxLength={100} onChange={(e) => setCashApp(e.target.value)} data-testid="input-cashapp" /></Field>
        </div>
      </fieldset>

      {Object.keys(errors).length > 0 && <p className="text-sm font-bold text-destructive" role="alert">Fix the highlighted fields to continue.</p>}
      {serverError && (
        <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm font-medium" role="alert" data-testid="text-submit-error">{serverError}</div>
      )}
      <Button type="submit" disabled={busy} className="rounded-2xl py-7 text-lg font-bold" data-testid="button-submit-application">
        {busy ? "Saving your application..." : "Submit application"}
      </Button>
    </form>
  );
}

function Field({ id, label, required, error, help, children }: { id: string; label: string; required?: boolean; error?: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="font-bold">{label} {required ? <span className="text-destructive">*</span> : <span className="text-muted-foreground font-normal text-xs">optional</span>}</Label>
      {help && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{help}</p>}
      {children}
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

function QuestionField({ q, value, error, onChange }: { q: GraduateQuestion; value: string; error?: string; onChange: (v: string) => void }) {
  const id = `q-${q.id}`;
  return (
    <Field id={id} label={q.label} required={q.required} error={error} help={q.help}>
      {q.kind === "long" ? (
        <Textarea id={id} rows={5} value={value} maxLength={10000} onChange={(e) => onChange(e.target.value)} data-testid={`input-question-${q.id}`} />
      ) : (
        <Input id={id} type={q.kind === "url" ? "url" : "text"} placeholder={q.kind === "url" ? "https://" : undefined} value={value} maxLength={q.kind === "url" ? 2000 : 1000} onChange={(e) => onChange(e.target.value)} data-testid={`input-question-${q.id}`} />
      )}
    </Field>
  );
}
