import { format } from "date-fns";
import type { AdminRegistration, ReunionFee } from "@workspace/api-client-react";
import {
  Ban, ClipboardCheck, Info, MoreHorizontal, Pencil, Receipt, Send, Users, Package, Wallet, GitBranch,
} from "lucide-react";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { LedgerStatusBadge } from "../payments/LedgerPanel";
import { money } from "../payments/money";
import { computeTotal } from "../../lib/fees";
import { registrationAddOns } from "../../lib/registrationAddOns";
import { describeChoices, centsLabel } from "../../lib/addOns";
import { FIELD_LABEL, type ViewField } from "../../lib/registrationView";

export type DetailKind = "summary" | "branch" | "attendees" | "addons";

export interface RegistrationActions {
  onCheckIn: (id: number) => void;
  onPayments: (id: number) => void;
  onSubmissions: (id: number) => void;
  /** Null when editing isn't available (no event code). */
  onEdit: ((id: number) => void) | null;
  onTransfer: (id: number) => void;
  onCancel: (id: number) => void;
  onDetails: (id: number, kind: DetailKind) => void;
}

const COLUMN_ORDER: ViewField[] = ["branch", "attendees", "addons", "date", "checkin", "balance", "payment"];

export function addOnSummary(fees: ReunionFee[], reg: AdminRegistration) {
  const addOns = registrationAddOns(fees, reg.selectedFeeIds ?? [], reg.attendees);
  const quantity = addOns.reduce((s, i) => s + i.quantity, 0);
  const purchases = [...reg.attendees.flatMap((a) => a.addOns ?? []), ...(reg.addOns ?? [])];
  return { addOns, purchases, count: quantity + purchases.length };
}

function checkInCounts(reg: AdminRegistration) {
  const checkedIn = reg.attendees.filter((a) => a.checkedInAt).length;
  return { checkedIn, total: reg.attendees.length };
}

function CancelledBadge({ reg }: { reg: AdminRegistration }) {
  return (
    <span className="inline-flex flex-col gap-0.5" data-testid={`status-cancelled-${reg.id}`}>
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-destructive/10 text-destructive w-fit">
        Cancelled
      </span>
      {reg.cancellationResolution && reg.cancellationResolution !== "no_payment" && (
        <span className="text-[10px] text-muted-foreground leading-tight">
          {reg.cancellationResolution === "refunded" ? "Refunded" : "Fund donated"}
        </span>
      )}
    </span>
  );
}

export function RegistrationTable({
  rows, fields, fees, isLoading, submissionCount, actions,
}: {
  rows: AdminRegistration[];
  fields: ViewField[];
  fees: ReunionFee[];
  isLoading: boolean;
  submissionCount: (id: number) => number;
  actions: RegistrationActions;
}) {
  const columns = COLUMN_ORDER.filter((f) => fields.includes(f));
  const showEdit = fields.includes("edit") && !!actions.onEdit;
  const showTransfer = fields.includes("transfer");
  const hasActionCol = showEdit || showTransfer;
  const span = 2 + columns.length + (hasActionCol ? 1 : 0);

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="w-full text-sm text-left" data-testid="table-registrations">
        <thead className="text-[11px] text-muted-foreground uppercase tracking-[0.12em] bg-muted/50">
          <tr>
            <th scope="col" className="px-4 py-3 rounded-l-xl">Registrant</th>
            {columns.map((c) => <th key={c} scope="col" className="px-4 py-3 whitespace-nowrap">{FIELD_LABEL[c]}</th>)}
            {hasActionCol && <th scope="col" className="px-4 py-3">Actions</th>}
            <th scope="col" className="relative px-2 py-3 rounded-r-xl w-12"><span className="sr-only">Registration menu</span></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {isLoading ? (
            [0, 1, 2].map((i) => (
              <tr key={i} data-testid="row-loading">
                <td colSpan={span} className="px-4 py-4"><Skeleton className="h-9 w-full rounded-lg" /></td>
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr><td colSpan={span} className="text-center py-10 text-muted-foreground" data-testid="text-empty">No registrations match these filters.</td></tr>
          ) : rows.map((reg) => {
            const isCancelled = reg.status === "cancelled";
            const notes = submissionCount(reg.id);
            const { addOns, purchases, count } = addOnSummary(fees, reg);
            const { checkedIn, total } = checkInCounts(reg);
            const allIn = total > 0 && checkedIn === total;
            const name = reg.userName || "Unknown";
            return (
              <tr key={reg.id} data-testid={`row-registration-${reg.id}`} className={`transition-colors hover:bg-muted/25 ${isCancelled ? "bg-muted/10" : ""}`}>
                <td className={`px-4 py-3 ${isCancelled ? "opacity-70" : ""}`}>
                  <div className="font-medium text-foreground flex items-center gap-2 flex-wrap">
                    <span data-testid={`text-registrant-${reg.id}`}>{name}</span>
                    <span className="text-[11px] text-muted-foreground font-mono bg-muted px-1 rounded">#{reg.id}</span>
                  </div>
                  <div className="text-muted-foreground text-xs flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="truncate max-w-[180px]">{reg.userEmail}</span>
                    {reg.registrantIsManaged && (
                      <span className="inline-block bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                        Registered by organizer
                      </span>
                    )}
                  </div>
                  {isCancelled && !fields.includes("payment") && <div className="mt-1"><CancelledBadge reg={reg} /></div>}
                </td>
                {columns.map((c) => {
                  switch (c) {
                    case "branch":
                      return <td key={c} className="px-4 py-3 font-medium">{reg.branchName}</td>;
                    case "attendees":
                      return (
                        <td key={c} className="px-4 py-3">
                          <div className="font-bold">{reg.attendeeCount}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[150px]" title={reg.attendees.map((a) => a.name).join(", ")}>
                            {reg.attendees.map((a) => a.name).join(", ")}
                          </div>
                        </td>
                      );
                    case "addons":
                      return (
                        <td key={c} className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-bold">{count} {count === 1 ? "add-on" : "add-ons"}</span>
                            {addOns.map(({ fee, quantity }) => (
                              <span key={fee.id} className="text-xs text-muted-foreground">
                                {fee.label} × {quantity}{fee.chargeType === "flat" ? " (household)" : ""}
                              </span>
                            ))}
                            {purchases.map((p, i) => (
                              <span key={`p-${i}`} className="text-xs text-muted-foreground" data-testid={`text-addon-${reg.id}-${i}`}>
                                {p.label}{p.choices.length ? ` (${describeChoices(p)})` : ""} · {centsLabel(p.unitPriceCents)}{(reg.addOns ?? []).includes(p) ? " (household)" : ""}
                              </span>
                            ))}
                          </div>
                        </td>
                      );
                    case "date":
                      return <td key={c} className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">{format(new Date(reg.createdAt), "MMM d, yyyy")}</td>;
                    case "checkin":
                      return (
                        <td key={c} className="px-4 py-3">
                          {!isCancelled && (
                            <Button
                              variant="outline"
                              size="sm"
                              data-testid={`button-checkin-${reg.id}`}
                              aria-label={`Check in ${name}: ${checkedIn} of ${total} arrived`}
                              className={`h-8 px-2 text-xs rounded-lg ${allIn ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-200 hover:text-green-800" : checkedIn > 0 ? "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200 hover:text-amber-800" : ""}`}
                              onClick={() => actions.onCheckIn(reg.id)}
                            >
                              <ClipboardCheck className="w-3 h-3 mr-1" aria-hidden /> {checkedIn}/{total}
                            </Button>
                          )}
                        </td>
                      );
                    case "balance":
                      return (
                        <td key={c} className="px-4 py-3 whitespace-nowrap" data-testid={`text-balance-${reg.id}`}>
                          {reg.ledger ? (
                            <div className="flex flex-col">
                              <span className={`font-bold tabular-nums ${isCancelled || reg.ledger.waived ? "text-muted-foreground" : reg.ledger.balanceCents === 0 ? "text-green-600" : "text-red-600"}`}>
                                {money(reg.ledger.balanceCents)}
                              </span>
                              <span className="text-[11px] text-muted-foreground tabular-nums">
                                {money(reg.ledger.confirmedCents + reg.ledger.legacyCreditCents)} paid of {money(reg.ledger.chargeCents)}
                              </span>
                              {reg.ledger.creditCents > 0 && (
                                <span className="text-[11px] font-bold text-sky-700">{money(reg.ledger.creditCents)} credit</span>
                              )}
                            </div>
                          ) : (
                            <span className="font-bold tabular-nums">
                              {money(Math.round(computeTotal(fees, reg.attendees, reg.selectedFeeIds ?? [], reg.addOns ?? []) * 100))}
                            </span>
                          )}
                        </td>
                      );
                    case "payment":
                      return (
                        <td key={c} className="px-4 py-3">
                          {isCancelled ? <CancelledBadge reg={reg} /> : (
                            <div className="flex flex-col items-start gap-1.5">
                              <LedgerStatusBadge status={reg.ledger?.status ?? (reg.paymentStatus === "pending" ? "unpaid" : reg.paymentStatus)} />
                              <Button variant="outline" size="sm" className="h-7 px-2 text-xs rounded-lg" onClick={() => actions.onPayments(reg.id)} data-testid={`button-payments-${reg.id}`} aria-label={`Payments for ${name}`}>
                                <Wallet className="w-3 h-3 mr-1" aria-hidden /> Payments
                              </Button>
                            </div>
                          )}
                          {notes > 0 && (
                            <button type="button" onClick={() => actions.onSubmissions(reg.id)} className="mt-1.5 flex items-center gap-1 text-xs font-bold text-primary hover:underline">
                              <Receipt className="w-3.5 h-3.5" aria-hidden /> {notes} {notes === 1 ? "payment note" : "payment notes"}
                            </button>
                          )}
                        </td>
                      );
                    default:
                      return null;
                  }
                })}
                {hasActionCol && (
                  <td className="px-4 py-3">
                    {!isCancelled && (
                      <div className="flex flex-wrap gap-1.5">
                        {showEdit && (
                          <Button variant="outline" size="sm" className="h-8 px-2 text-xs rounded-lg" onClick={() => actions.onEdit!(reg.id)} data-testid={`button-edit-${reg.id}`} aria-label={`Edit ${name}`}>
                            <Pencil className="w-3 h-3 mr-1" aria-hidden /> Edit
                          </Button>
                        )}
                        {showTransfer && (
                          <Button variant="outline" size="sm" className="h-8 px-2 text-xs rounded-lg" onClick={() => actions.onTransfer(reg.id)} data-testid={`button-transfer-${reg.id}`} aria-label={`Transfer ${name}`}>
                            <Send className="w-3 h-3 mr-1" aria-hidden /> Transfer
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                )}
                <td className="px-2 py-3 text-right">
                  <RegistrationRowMenu reg={reg} name={name} notes={notes} actions={actions} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RegistrationRowMenu({ reg, name, notes, actions }: { reg: AdminRegistration; name: string; notes: number; actions: RegistrationActions }) {
  const isCancelled = reg.status === "cancelled";
  const item = "gap-2 py-2 cursor-pointer";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg data-[state=open]:bg-muted"
          aria-label={`Registration menu for ${name} (#${reg.id})`}
          data-testid={`button-menu-${reg.id}`}
        >
          <MoreHorizontal className="w-4 h-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl" data-testid={`menu-registration-${reg.id}`}>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground truncate">{name} · #{reg.id}</DropdownMenuLabel>
        <DropdownMenuItem className={item} onSelect={() => actions.onDetails(reg.id, "summary")}>
          <Info className="w-4 h-4" aria-hidden /> Registration details
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => actions.onDetails(reg.id, "branch")} data-testid={`menu-branch-${reg.id}`}>
          <GitBranch className="w-4 h-4" aria-hidden /> Branch: <span className="truncate font-medium">{reg.branchName}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => actions.onDetails(reg.id, "attendees")} data-testid={`menu-attendees-${reg.id}`}>
          <Users className="w-4 h-4" aria-hidden /> Attendees ({reg.attendeeCount})
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => actions.onDetails(reg.id, "addons")} data-testid={`menu-addons-${reg.id}`}>
          <Package className="w-4 h-4" aria-hidden /> Add-ons
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {!isCancelled && (
          <DropdownMenuItem className={item} onSelect={() => actions.onCheckIn(reg.id)} data-testid={`menu-checkin-${reg.id}`}>
            <ClipboardCheck className="w-4 h-4" aria-hidden /> Check-in
          </DropdownMenuItem>
        )}
        {!isCancelled && (
          <DropdownMenuItem className={item} onSelect={() => actions.onPayments(reg.id)} data-testid={`menu-payments-${reg.id}`}>
            <Wallet className="w-4 h-4" aria-hidden /> Payments
          </DropdownMenuItem>
        )}
        {notes > 0 && (
          <DropdownMenuItem className={item} onSelect={() => actions.onSubmissions(reg.id)} data-testid={`menu-notes-${reg.id}`}>
            <Receipt className="w-4 h-4" aria-hidden /> Payment notes ({notes})
          </DropdownMenuItem>
        )}
        {!isCancelled && actions.onEdit && (
          <DropdownMenuItem className={item} onSelect={() => actions.onEdit!(reg.id)} data-testid={`menu-edit-${reg.id}`}>
            <Pencil className="w-4 h-4" aria-hidden /> Edit
          </DropdownMenuItem>
        )}
        {!isCancelled && (
          <DropdownMenuItem className={item} onSelect={() => actions.onTransfer(reg.id)} data-testid={`menu-transfer-${reg.id}`}>
            <Send className="w-4 h-4" aria-hidden /> Transfer
          </DropdownMenuItem>
        )}
        {!isCancelled && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={`${item} text-destructive focus:text-destructive focus:bg-destructive/10`} onSelect={() => actions.onCancel(reg.id)} data-testid={`menu-cancel-${reg.id}`}>
              <Ban className="w-4 h-4" aria-hidden /> Cancel registration
            </DropdownMenuItem>
          </>
        )}
        {isCancelled && (
          <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <Info className="w-3.5 h-3.5" aria-hidden /> Cancelled: actions unavailable
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
