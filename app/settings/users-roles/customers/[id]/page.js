"use client";

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  Plus,
  Trash2,
  Pin,
  PinOff,
  Package,
  BookOpen,
  StickyNote,
  User,
  ChevronDown,
  ArrowUpDown,
  X,
  CreditCard,
  Wallet,
  RotateCcw,
  Receipt,
  ClipboardList,
  Users,
  FileText,
  Send,
  Tag,
  Sparkles,
  Calendar,
  CalendarX,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  History,
} from "lucide-react";
import MainLayout from "@/components/layout/MainLayout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import CreateEnrollmentSheet from "@/components/enrollment/CreateEnrollmentSheet";
import CustomerMembershipsTab from "@/components/membership/CustomerMembershipsTab";
import CustomerWalletTab from "@/components/wallet/CustomerWalletTab";
import CancelRefundDialog from "@/components/shared/CancelRefundDialog";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import LocationSelector from "@/components/shared/LocationSelector";
import SendPaymentLinkMenu from "@/components/payments/SendPaymentLinkMenu";
import api from "@/lib/api";
import { resolveLocationID } from "@/app/settings/payments/clover/useCloverConnection";
import { useCardProcessor } from "@/app/settings/payments/useCardProcessor";
import {
  openCheckoutTab,
  navigateCheckoutTab,
  closeCheckoutTab,
  CHECKOUT_TOAST,
} from "@/lib/clover";
import { PAYMENT_METHODS } from "@/lib/paymentMethods";
import WalletShortfallField, {
  walletPaymentFields,
} from "@/components/payments/WalletShortfallField";
import TerminalDeviceField from "@/components/payments/TerminalDeviceField";
import { fetchWalletBalance } from "@/lib/wallet";
import { useToast } from "@/components/ui/toast";
import { getInitials, formatDate } from "@/lib/utils";
import {
  customerLifecycleBadgeClass,
  customerLifecycleLabel,
  CUSTOMER_LIFECYCLE_STATUS_OPTIONS,
} from "@/lib/customer-lifecycle";
import { formatReasonLabel } from "@/lib/dynamic-list-normalize";
import { extractLeadReasonsList } from "@/lib/workflow-normalize";

// ─── helpers ────────────────────────────────────────────────────────────────

// Short name for an enrollment. A real package uses its template name; a
// services-only sale ("Services") is named by the service(s) it holds instead.
function enrollmentDisplayName(enr) {
  const pkg = enr?.package;
  if (!pkg) return enr?.label ?? "";
  if (pkg.packageRef) {
    return pkg.packageName ?? pkg.packageRef?.packageName ?? enr?.label ?? "";
  }
  const svcNames = [
    ...new Set(
      (pkg.services ?? [])
        .map((s) => s.serviceName || s.serviceCode)
        .filter(Boolean),
    ),
  ].join(", ");
  return enr?.label || svcNames || pkg.packageName || "";
}

function statusColor(status) {
  return (
    {
      active: "bg-success/10 text-success",
      expired: "bg-warning/10 text-warning",
      exhausted: "bg-rose-500/10 text-rose-600",
      cancelled: "bg-muted text-muted-foreground",
    }[status] ?? "bg-muted text-muted-foreground"
  );
}

function paymentStatusColor(ps) {
  return (
    {
      paid: "bg-success/10 text-success",
      partial: "bg-warning/10 text-warning",
      unpaid: "bg-rose-500/10 text-rose-600",
      payment_pending: "bg-warning/10 text-warning",
    }[ps] ?? "bg-muted text-muted-foreground"
  );
}

function paymentStatusLabel(ps) {
  return ps === "payment_pending" ? "payment pending" : (ps ?? "unpaid");
}

function paymentTypeBadge(type) {
  return (
    {
      package_purchase: {
        label: "Package Sale",
        cls: "bg-info/10 text-info",
      },
      credit_topup: {
        label: "Credit Top-up",
        cls: "bg-violet-500/10 text-violet-600",
      },
      refund: { label: "Refund", cls: "bg-rose-500/10 text-rose-600" },
    }[type] ?? { label: type, cls: "bg-muted text-muted-foreground" }
  );
}

function SessionBar({ used, total }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 mt-0.5">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground shrink-0">
        {total - used} left / {total}
      </span>
    </div>
  );
}

function FormField({ label, required, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[12px] font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ─── IssueRefundDialog ───────────────────────────────────────────────────────

const refIdOf = (ref) => ref?._id ?? ref ?? null;

// Where the refunded money goes. Anything originally taken on a card is returned to that
// card by Clover regardless of this choice; it decides what happens to the rest.
const REFUND_DESTINATIONS = [
  { value: "wallet", label: "Wallet (store credit)" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
];

function IssueRefundDialog({ open, onClose, payment, customerID, onSuccess }) {
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("wallet");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function reset() {
    setAmount("");
    setDestination("wallet");
    setNotes("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) return;
    setSaving(true);
    // The endpoint refunds against a customer's payments, not a paymentID — it was being
    // sent one, so the required fields were missing and every refund failed.
    const res = await api.post("/api/payment/refund", {
      customerID,
      enrollmentID: refIdOf(payment.enrollmentID) || undefined,
      method: destination,
      amount: num,
      notes: notes.trim() || undefined,
    });
    if (res.success) {
      toast.success("Refund issued.");
      reset();
      onSuccess();
      onClose();
    } else {
      toast.error(res.error || "Failed to issue refund.");
    }
    setSaving(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Issue Refund</DialogTitle>
        </DialogHeader>
        {payment && (
          <p className="text-[12px] text-muted-foreground -mt-1">
            Original payment:{" "}
            <span className="text-foreground font-medium">
              ${Number(payment.amount).toFixed(2)}
            </span>{" "}
            via {payment.method}
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <FormField label="Refund amount" required>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
                $
              </span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                max={payment?.amount}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="h-9 w-full rounded-lg border border-border bg-background pl-7 pr-3 text-[13px] outline-none focus:border-primary"
              />
            </div>
          </FormField>
          <FormField label="Refund to" required>
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
            >
              {REFUND_DESTINATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            {destination === "wallet" && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Added to the customer's wallet to spend on a future purchase.
              </p>
            )}
          </FormField>
          <FormField label="Reason (optional)">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Class cancelled"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !amount}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {saving ? "Refunding…" : "Issue Refund"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "profile", label: "Profile", Icon: User },
  { id: "intro", label: "Trial", Icon: Sparkles },
  {
    id: "active-enrollments",
    label: " Enrollments",
    Icon: ClipboardList,
  },
  { id: "memberships", label: "Memberships", Icon: CreditCard },
  { id: "wallet", label: "Wallet", Icon: Wallet },
  { id: "purchases", label: "Events & Purchases", Icon: Receipt },
  { id: "payments", label: "Payment History", Icon: Receipt },
  { id: "lessons", label: "Lessons", Icon: BookOpen },
  { id: "history", label: "History", Icon: History },
  { id: "notes", label: "Notes", Icon: StickyNote },
  { id: "members", label: "Members", Icon: Users },
  { id: "contracts", label: "Contracts", Icon: FileText },
];

// ─── Tags ────────────────────────────────────────────────────────────────────

function TagsEditor({ customer, onUpdated }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [orgTags, setOrgTags] = useState([]);
  const toast = useToast();
  const tags = customer.tags || [];

  useEffect(() => {
    api.get("/api/customer/tags").then((res) => {
      if (res.success) setOrgTags(res.data || []);
    });
  }, []);

  async function saveTags(nextTags) {
    setSaving(true);
    const res = await api.put(`/api/customer/${customer._id}`, {
      tags: nextTags,
    });
    if (res.success) {
      onUpdated();
      setOrgTags((prev) => [...new Set([...prev, ...nextTags])].sort());
    } else {
      toast.error(res.error || "Failed to update tags.");
    }
    setSaving(false);
  }

  function addTag(e) {
    e.preventDefault();
    const value = draft.trim();
    if (!value || tags.includes(value)) return;
    setDraft("");
    saveTags([...tags, value]);
  }

  function removeTag(tag) {
    saveTags(tags.filter((t) => t !== tag));
  }

  const suggestions = orgTags.filter((t) => !tags.includes(t));
  const autoTags = customer.autoTags || [];

  return (
    <div>
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        Tags
      </p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tags.length === 0 && autoTags.length === 0 && (
          <p className="text-[13px] text-muted-foreground">No tags yet.</p>
        )}
        {autoTags.map((tag) => (
          <span
            key={`auto-${tag}`}
            title="Automatically applied — recomputed nightly"
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
          >
            <Tag className="h-3 w-3" />
            {tag}
          </span>
        ))}
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary"
          >
            <Tag className="h-3 w-3" />
            {tag}
            <button
              type="button"
              disabled={saving}
              onClick={() => removeTag(tag)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {suggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              disabled={saving}
              onClick={() => saveTags([...tags, tag])}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary"
            >
              <Plus className="h-3 w-3" />
              {tag}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={addTag} className="flex gap-2">
        <input
          type="text"
          list="tag-suggestions"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a tag…"
          className="h-8 flex-1 max-w-[200px] rounded-lg border border-border bg-background px-2.5 text-[12px] text-foreground outline-none focus:border-primary"
        />
        <datalist id="tag-suggestions">
          {orgTags.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-8 px-2.5"
          disabled={saving || !draft.trim()}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}

// ─── Balance Breakdown ───────────────────────────────────────────────────────

// Consolidates every payment-related balance concept scattered across the
// Enrollments/Memberships/Wallet tabs into one place: what the customer owes
// (per package/membership, so staff can see exactly where an outstanding
// total is coming from) and what they have available to spend (Wallet — the
// only spendable balance the app has; customer.credits/"Store Credit" was a
// legacy field nothing writes to anymore, so it isn't read here) — two
// different, easily-conflated numbers, kept visibly separate rather than
// netted together.
function BalanceBreakdownCard({ customer }) {
  const [loading, setLoading] = useState(true);
  const [owedBreakdown, setOwedBreakdown] = useState([]); // [{ label, amount, type }]
  const [walletBalance, setWalletBalance] = useState(0);

  useEffect(() => {
    if (!customer?._id) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      // Explicit limit — the list endpoint defaults to 20 per page, which
      // would silently drop any enrollment past the first page for a
      // long-tenured customer.
      api.get(`/api/enrollment?customerID=${customer._id}&limit=500`),
      api.get(`/api/customer-membership/customer/${customer._id}`),
      fetchWalletBalance(customer._id),
    ]).then(([enrRes, memRes, wallet]) => {
      if (cancelled) return;
      // package.dueAmount / membership.dueAmount are snapshot fields that
      // aren't always kept in sync (e.g. mid-payment-plan) — `!= null`
      // means "the snapshot is trustworthy", but when it's null the real
      // outstanding amount still exists, just has to be derived the same
      // way the payment-plan scheduler on this page already does
      // (`cp.dueAmount != null ? dueAmount : totalPaid - amountCollected`).
      // Reading only dueAmount directly here silently dropped any
      // enrollment/membership that had fallen out of sync.
      const packages = (enrRes.success ? enrRes.data || [] : [])
        .map((enr) => {
          const pkg = enr.package;
          // A cancelled package/enrollment shouldn't keep contributing to
          // Outstanding — its stale dueAmount snapshot otherwise lingers
          // here even after the cancel flow has zeroed/refunded it.
          if (!pkg || pkg.status === "cancelled" || enr.status === "cancelled") return null;
          const due =
            pkg.dueAmount != null
              ? Number(pkg.dueAmount)
              : Math.max(0, Number(pkg.totalPaid || 0) - Number(pkg.amountCollected || 0));
          return due > 0 ? { label: pkg.packageName || "Package", amount: due, type: "Package" } : null;
        })
        .filter(Boolean);
      const memberships = (memRes.success ? memRes.data || [] : [])
        .map((m) => {
          if (m.status === "cancelled") return null;
          const due =
            m.dueAmount != null
              ? Number(m.dueAmount)
              : Math.max(0, Number(m.price || 0) - Number(m.amountCollected || 0));
          return due > 0 ? { label: m.membershipName || "Membership", amount: due, type: "Membership" } : null;
        })
        .filter(Boolean);
      setOwedBreakdown([...packages, ...memberships].sort((a, b) => b.amount - a.amount));
      setWalletBalance(Number(wallet) || 0);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [customer?._id]);

  const totalOwed = owedBreakdown.reduce((sum, row) => sum + row.amount, 0);
  // Wallet is the only spendable balance a customer can have — customer.credits
  // ("Store Credit") is a legacy field nothing writes to anymore, so it isn't
  // read here. "Available" used to be Wallet + Store Credit; now that Store
  // Credit is gone, that sum would just be Wallet Balance again — collapsed
  // into one tile below instead of showing the same number twice.

  const availableBreakdown = [
    walletBalance > 0 && { label: "Wallet Balance", amount: walletBalance, type: "Wallet" },
  ].filter(Boolean);

  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
      <h2 className="text-[13px] font-semibold text-foreground">Balance Summary</h2>
      {loading ? (
        <p className="text-[12px] text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
                <AlertTriangle className="h-3 w-3" />
                Outstanding
              </p>
              <p
                className={`text-[19px] font-semibold ${totalOwed > 0 ? "text-destructive" : "text-foreground"}`}
              >
                ${totalOwed.toFixed(2)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
                <Wallet className="h-3 w-3" />
                Wallet Balance
              </p>
              <p className="text-[19px] font-semibold text-success">
                ${walletBalance.toFixed(2)}
              </p>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Where it's coming from
            </p>
            {owedBreakdown.length === 0 && availableBreakdown.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                No outstanding balance and no available funds.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {owedBreakdown.map((row, i) => (
                  <div
                    key={`owed-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-destructive/5 px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-foreground">
                      <Package className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{row.label}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        ({row.type} due)
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] font-semibold text-destructive">
                      ${row.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
                {availableBreakdown.map((row, i) => (
                  <div
                    key={`avail-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-success/5 px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-foreground">
                      {row.type === "Wallet" ? (
                        <Wallet className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <CreditCard className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{row.label}</span>
                    </span>
                    <span className="shrink-0 text-[12px] font-semibold text-success">
                      ${row.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Profile Tab ─────────────────────────────────────────────────────────────

function ProfileTab({ customer, locations, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [leadReasons, setLeadReasons] = useState([]);
  // Quick-save for just the callback date, without entering full profile
  // edit mode — mirrors saveCallbackDate() in app/leads/components/LeadsDialog.js
  // so Customers gets the same "update the follow-up reminder in one click"
  // UX Leads already has, instead of requiring the whole profile form.
  const [callbackDateDraft, setCallbackDateDraft] = useState(
    customer.callbackDate ? String(customer.callbackDate).slice(0, 10) : "",
  );
  const [savingCallbackDate, setSavingCallbackDate] = useState(false);
  const [customerEvents, setCustomerEvents] = useState([]);
  const [sessionStats, setSessionStats] = useState({
    usedValue: 0,
    scheduledValue: 0,
    remainingValue: 0,
    usedCount: 0,
    scheduledCount: 0,
    remainingCount: 0,
    totalCount: 0,
    completedCount: 0,
    completedValue: 0,
  });
  const toast = useToast();

  useEffect(() => {
    api.get("/api/lead-reasons").then((res) => {
      if (res?.success) setLeadReasons(extractLeadReasonsList(res));
    });
  }, []);

  useEffect(() => {
    setCallbackDateDraft(
      customer.callbackDate ? String(customer.callbackDate).slice(0, 10) : "",
    );
  }, [customer?._id, customer?.callbackDate]);

  async function saveCallbackDate() {
    if (!customer?._id) return;
    setSavingCallbackDate(true);
    const res = await api.put(`/api/customer/${customer._id}`, {
      callbackDate: callbackDateDraft || null,
    });
    if (res.success) {
      toast.success("Callback date updated.");
      onUpdated();
    } else {
      toast.error(res.error || "Unable to update callback date.");
    }
    setSavingCallbackDate(false);
  }

  useEffect(() => {
    if (!customer?._id) return;
    const now = new Date();
    const past = new Date(now);
    past.setDate(past.getDate() - 60);
    const future = new Date(now);
    future.setDate(future.getDate() + 60);
    const params = new URLSearchParams({
      start: past.toISOString(),
      end: future.toISOString(),
      limit: 200,
    });
    api.get(`/api/calendar?${params}`).then((res) => {
      if (res.success && Array.isArray(res.data)) {
        const custId = String(customer._id);
        const filtered = res.data.filter((ev) => {
          const ids = Array.isArray(ev.customerIDs) ? ev.customerIDs : [];
          return ids.some((c) => String(c?._id ?? c) === custId);
        });
        setCustomerEvents(filtered);
      }
    });
  }, [customer?._id]);

  useEffect(() => {
    if (!customer?._id) return;
    api
      .get(`/api/enrollment?customerID=${customer._id}&status=active`)
      .then(async (enrRes) => {
        if (!enrRes.success) return;
        const list = enrRes.data || [];
        if (!list.length) return;
        const detResults = await Promise.all(
          list.map((e) => api.get(`/api/customer-package/${e._id}/details`)),
        );
        let usedCount = 0,
          remainingCount = 0,
          totalCount = 0,
          completedCount = 0;
        let usedValue = 0,
          remainingValue = 0,
          completedValue = 0;
        detResults.forEach((res) => {
          if (!res.success) return;
          const services = res.data?.services ?? [];
          services.forEach((svc) => {
            const price = Number(svc.pricePerSession) || 0;
            const used = svc.sessionsUsed ?? 0;
            // sessionsUsed is the count deducted from the package balance —
            // it includes sessions booked for a future date, not just ones
            // that have actually happened. sessionsCompleted (derived
            // server-side from past/completed CalendarEvents) is the true
            // attendance count.
            const completed = svc.sessionsCompleted ?? 0;
            const sched = svc.sessionsScheduled ?? 0;
            const remaining = Math.max(0, (svc.sessionsTotal ?? 0) - used);
            usedCount += used;
            remainingCount += remaining;
            totalCount += svc.sessionsTotal ?? 0;
            usedValue += used * price;
            remainingValue += remaining * price;
            completedCount += completed;
            completedValue += completed * price;
          });
        });
        // Derive scheduled count from future calendar events
        const now = new Date();
        const scheduledCount = customerEvents.filter(
          (ev) => new Date(ev.startDateTime) > now,
        ).length;
        const scheduledValue = 0; // price per scheduled session not reliably available without per-event charge lookup
        setSessionStats({
          usedValue,
          scheduledValue,
          remainingValue,
          usedCount,
          scheduledCount,
          remainingCount,
          totalCount,
          completedCount,
          completedValue,
        });
      });
  }, [customer?._id, customerEvents]);

  function startEdit() {
    setForm({
      name: customer.name || "",
      email: customer.email || "",
      phoneNumber: customer.phoneNumber || "",
      locationID: Array.isArray(customer.locationID)
        ? customer.locationID.map((l) => String(l?._id ?? l)).filter(Boolean)
        : customer.locationID
          ? [String(customer.locationID?._id ?? customer.locationID)]
          : [],
      dateOfBirth: customer.dateOfBirth
        ? String(customer.dateOfBirth).slice(0, 10)
        : "",
      gender: customer.gender || "",
      callbackDate: customer.callbackDate
        ? String(customer.callbackDate).slice(0, 10)
        : "",
      lifecycleStatus: customer.lifecycleStatus || "active",
      address: {
        street: customer.address?.street || "",
        city: customer.address?.city || "",
        state: customer.address?.state || "",
        zipCode: customer.address?.zipCode || "",
        country: customer.address?.country || "USA",
      },
    });
    setEditing(true);
  }

  async function saveProfile(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    if (!Array.isArray(form.locationID) || form.locationID.length === 0) {
      toast.error("Please select at least one location.");
      return;
    }
    setSaving(true);
    const addr = {
      street: form.address.street.trim(),
      city: form.address.city.trim(),
      state: form.address.state.trim(),
      zipCode: form.address.zipCode.trim(),
      country: form.address.country.trim() || "USA",
    };
    const hasAddress = addr.street || addr.city || addr.state || addr.zipCode;
    const res = await api.put(`/api/customer/${customer._id}`, {
      name: form.name.trim(),
      email: form.email.trim(),
      phoneNumber: form.phoneNumber.trim() || undefined,
      locationID: form.locationID || undefined,
      dateOfBirth: form.dateOfBirth || undefined,
      gender: form.gender || undefined,
      callbackDate: form.callbackDate || null,
      lifecycleStatus: form.lifecycleStatus || "active",
      address: hasAddress ? addr : undefined,
    });
    if (res.success) {
      toast.success("Profile saved.");
      onUpdated();
      setEditing(false);
    } else toast.error(res.error || "Save failed.");
    setSaving(false);
  }

  const locationName = (raw) => {
    const ids = Array.isArray(raw)
      ? raw.map((l) => String(l?._id ?? l)).filter(Boolean)
      : raw
        ? [String(raw?._id ?? raw)]
        : [];
    if (!ids.length) return "—";
    const names = ids
      .map((id) => locations.find((l) => String(l._id) === id)?.name)
      .filter(Boolean);
    if (!names.length) return "—";
    if (names.length <= 2) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  };

  return (
    <div className="space-y-6">
      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Member Since", value: formatDate(customer.memberSince ?? customer.createdAt) },
          {
            label: `Sessions Completed (${sessionStats.completedCount ?? 0})`,
            value: `$${(sessionStats.completedValue ?? 0).toFixed(2)}`,
            accent: "text-info",
          },
          {
            label: "Scheduled Events",
            value: sessionStats.scheduledCount,
            accent: "text-violet-500",
          },
        ].map(({ label, value, accent }) => (
          <div
            key={label}
            className="rounded-xl border border-border bg-card px-4 py-3"
          >
            <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
            <p
              className={`text-[15px] font-semibold ${accent ?? "text-foreground"}`}
            >
              {value}
            </p>
          </div>
        ))}
        {/* Remaining sessions card */}
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[11px] text-muted-foreground mb-1">
            Remaining Sessions
          </p>
          <div className="flex items-baseline gap-1.5">
            <p className="text-[15px] font-semibold text-success">
              {sessionStats.remainingCount}
            </p>
            <p className="text-[12px] text-muted-foreground">
              / {sessionStats.totalCount} sess
            </p>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-success transition-all"
              style={{
                width:
                  sessionStats.totalCount > 0
                    ? `${(sessionStats.usedCount / sessionStats.totalCount) * 100}%`
                    : "0%",
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[10px] text-muted-foreground">
              {sessionStats.usedCount} used
            </p>
            <p className="text-[13px] font-semibold text-success">
              ${sessionStats.remainingValue.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      <BalanceBreakdownCard customer={customer} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info card */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-foreground">
              Personal details
            </h2>
            {!editing && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-[12px]"
                onClick={startEdit}
              >
                <Pencil className="h-3 w-3 mr-1.5" /> Edit
              </Button>
            )}
          </div>

          {editing ? (
            <form onSubmit={saveProfile} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Name" required>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                  />
                </FormField>
                <FormField label="Email" required>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                  />
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Phone">
                  <input
                    type="tel"
                    value={form.phoneNumber}
                    onChange={(e) =>
                      setForm({ ...form, phoneNumber: e.target.value })
                    }
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                  />
                </FormField>
                <FormField label="Location">
                  <LocationSelector
                    value={
                      Array.isArray(form.locationID)
                        ? form.locationID
                        : form.locationID
                          ? [form.locationID]
                          : []
                    }
                    onChange={(ids) => setForm({ ...form, locationID: ids })}
                    multiple
                    showAllOption={false}
                    placeholder="Select location(s)…"
                  />
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Date of Birth">
                  <input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(e) =>
                      setForm({ ...form, dateOfBirth: e.target.value })
                    }
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                  />
                </FormField>
                <FormField label="Gender">
                  <div className="relative">
                    <select
                      value={form.gender}
                      onChange={(e) =>
                        setForm({ ...form, gender: e.target.value })
                      }
                      className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[13px] outline-none focus:border-primary"
                    >
                      <option value="">Select…</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                      <option value="prefer_not_to_say">
                        Prefer not to say
                      </option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </FormField>
                <FormField label="Callback date">
                  <input
                    type="date"
                    value={form.callbackDate}
                    onChange={(e) =>
                      setForm({ ...form, callbackDate: e.target.value })
                    }
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                  />
                </FormField>
                <FormField label="Lifecycle status">
                  <div className="relative">
                    <select
                      value={form.lifecycleStatus || "active"}
                      onChange={(e) =>
                        setForm({ ...form, lifecycleStatus: e.target.value })
                      }
                      className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[13px] outline-none focus:border-primary"
                    >
                      {CUSTOMER_LIFECYCLE_STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </FormField>
              </div>
              <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[12px] font-semibold text-muted-foreground">
                  Address
                </p>
                <FormField label="Street">
                  <input
                    type="text"
                    value={form.address.street}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        address: { ...form.address, street: e.target.value },
                      })
                    }
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="City">
                    <input
                      type="text"
                      value={form.address.city}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          address: { ...form.address, city: e.target.value },
                        })
                      }
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                    />
                  </FormField>
                  <FormField label="State">
                    <input
                      type="text"
                      value={form.address.state}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          address: { ...form.address, state: e.target.value },
                        })
                      }
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Zip Code">
                    <input
                      type="text"
                      value={form.address.zipCode}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          address: { ...form.address, zipCode: e.target.value },
                        })
                      }
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                    />
                  </FormField>
                  <FormField label="Country">
                    <input
                      type="text"
                      value={form.address.country}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          address: { ...form.address, country: e.target.value },
                        })
                      }
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                    />
                  </FormField>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-5">
              {/* Contact */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Contact
                </p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  {[
                    { label: "Name", value: customer.name },
                    { label: "Email", value: customer.email },
                    { label: "Phone", value: customer.phoneNumber || "—" },
                    {
                      label: "Location",
                      value: locationName(customer.locationID),
                    },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-[11px] text-muted-foreground mb-0.5">
                        {label}
                      </p>
                      <p className="text-[13px] text-foreground break-all">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Personal */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Personal
                </p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-0.5">
                      Date of Birth
                    </p>
                    <p className="text-[13px] text-foreground">
                      {customer.dateOfBirth
                        ? formatDate(customer.dateOfBirth)
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-0.5">
                      Gender
                    </p>
                    <p className="text-[13px] text-foreground">
                      {customer.gender
                        ? customer.gender
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, (c) => c.toUpperCase())
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-0.5">
                      Callback date
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={callbackDateDraft}
                        onChange={(e) => setCallbackDateDraft(e.target.value)}
                        className="h-8 rounded-lg border border-border bg-background px-2.5 text-[13px] outline-none focus:border-primary"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={saveCallbackDate}
                        disabled={
                          savingCallbackDate ||
                          callbackDateDraft ===
                            (customer.callbackDate
                              ? String(customer.callbackDate).slice(0, 10)
                              : "")
                        }
                        className="h-8 shrink-0 px-2.5 text-[12px]"
                      >
                        {savingCallbackDate ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-0.5">
                      Lifecycle status
                    </p>
                    <span
                      className={[
                        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        customerLifecycleBadgeClass(customer.lifecycleStatus),
                      ].join(" ")}
                    >
                      {customerLifecycleLabel(customer.lifecycleStatus)}
                    </span>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-0.5">
                      Reason
                    </p>
                    <p className="text-[13px] text-foreground">
                      {customer.reason
                        ? formatReasonLabel(customer.reason, leadReasons)
                        : "—"}
                    </p>
                  </div>
                  {customer.actualReason ? (
                    <div className="col-span-2">
                      <p className="text-[11px] text-muted-foreground mb-0.5">
                        Their Words
                      </p>
                      <p className="text-[13px] text-foreground italic whitespace-pre-wrap">
                        “{customer.actualReason}”
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Address */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Address
                </p>
                {(() => {
                  const a = customer.address;
                  const hasAny =
                    a &&
                    [a.street, a.city, a.state, a.zipCode, a.country].some(
                      Boolean,
                    );
                  if (!hasAny)
                    return (
                      <p className="text-[13px] text-muted-foreground">—</p>
                    );
                  return (
                    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                      {[
                        { label: "Street", value: a.street },
                        { label: "City", value: a.city },
                        { label: "State", value: a.state },
                        { label: "Zip Code", value: a.zipCode },
                        { label: "Country", value: a.country },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-[11px] text-muted-foreground mb-0.5">
                            {label}
                          </p>
                          <p className="text-[13px] text-foreground">
                            {value || "—"}
                          </p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className="border-t border-border" />

              {/* Tags */}
              <TagsEditor customer={customer} onUpdated={onUpdated} />
            </div>
          )}
        </div>

        {/* Event cards */}
        <div className="flex flex-col gap-4">
          {/* Upcoming events */}
          <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold text-foreground">
              Upcoming Events
            </h2>
            {(() => {
              const now = new Date();
              const upcoming = customerEvents
                .filter((ev) => new Date(ev.startDateTime) > now)
                .sort(
                  (a, b) =>
                    new Date(a.startDateTime) - new Date(b.startDateTime),
                )
                .slice(0, 3);
              if (!upcoming.length)
                return (
                  <p className="text-[12px] text-muted-foreground">
                    No upcoming events.
                  </p>
                );
              return upcoming.map((ev, i) => {
                const date = new Date(ev.startDateTime);
                const instructor = ev.teacherID?.name;
                const label = ev.title || ev.calendarServiceID?.name || "Event";
                return (
                  <div
                    key={ev._id ?? i}
                    className="flex flex-col gap-0.5 rounded-lg bg-muted/40 px-3 py-2.5"
                  >
                    <span className="text-[12px] font-medium text-foreground leading-snug">
                      {label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {date.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                      {" · "}
                      {date.toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    {instructor && (
                      <span className="text-[11px] text-muted-foreground">
                        with {instructor}
                      </span>
                    )}
                  </div>
                );
              });
            })()}
          </div>

          {/* Recent completed events */}
          <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold text-foreground">
              Recent Completed
            </h2>
            {(() => {
              const now = new Date();
              const past = customerEvents
                .filter(
                  (ev) => new Date(ev.endDateTime ?? ev.startDateTime) <= now,
                )
                .sort(
                  (a, b) =>
                    new Date(b.startDateTime) - new Date(a.startDateTime),
                )
                .slice(0, 3);
              if (!past.length)
                return (
                  <p className="text-[12px] text-muted-foreground">
                    No completed events.
                  </p>
                );
              return past.map((ev, i) => {
                const date = new Date(ev.startDateTime);
                const instructor = ev.teacherID?.name;
                const label = ev.title || ev.calendarServiceID?.name || "Event";
                return (
                  <div
                    key={ev._id ?? i}
                    className="flex flex-col gap-0.5 rounded-lg bg-muted/40 px-3 py-2.5"
                  >
                    <span className="text-[12px] font-medium text-foreground leading-snug">
                      {label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {date.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                      {" · "}
                      {date.toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    {instructor && (
                      <span className="text-[11px] text-muted-foreground">
                        with {instructor}
                      </span>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>
      {/* end inner grid */}
    </div>
  );
}

// ─── PaymentSchedule ─────────────────────────────────────────────────────────

function PaymentSchedule({
  plan,
  cpStatus,
  onPayInstallment,
  onChangeDate,
  onAddInstallment,
  billingType,
  customerID,
  locationID,
  onSent,
}) {
  const [open, setOpen] = useState(false);
  const { ready: cloverReady } = useCardProcessor(locationID || plan);

  if (!plan) return null;

  const paidCount = plan.installments.filter((i) => i.status === "paid").length;

  return (
    <div className="mt-5 border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors w-full"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform shrink-0 ${open ? "" : "-rotate-90"}`}
        />
        Payment Schedule
        <div className="flex items-center gap-2 ml-1">
          <span
            className={`normal-case font-normal inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
              plan.status === "completed"
                ? "bg-success/10 text-success"
                : plan.status === "cancelled"
                  ? "bg-muted text-muted-foreground"
                  : "bg-violet-500/10 text-violet-600"
            }`}
          >
            {plan.status}
          </span>
          <span className="normal-case font-normal text-muted-foreground text-[11px]">
            {paidCount} / {plan.numberOfInstallments} paid
          </span>
        </div>
      </button>

      {open && (
        <div className="mt-3">
          <div className="rounded-lg border border-border overflow-hidden">
            {plan.installments.map((inst, idx) => {
              return (
                <div
                  key={idx}
                  className={`flex items-center justify-between px-3 py-2.5 ${idx > 0 ? "border-t border-border" : ""} ${inst.status === "paid" ? "bg-success/5" : ""}`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
                        inst.status === "paid"
                          ? "bg-success text-white"
                          : inst.status === "failed"
                            ? "bg-rose-600 text-white"
                            : inst.status === "payment_pending"
                              ? "bg-warning text-white"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {inst.status === "paid" ? "✓" : idx + 1}
                    </div>
                    <div>
                      <p className="text-[12px] text-foreground font-medium">
                        Payment {idx + 1}
                        {inst.status === "paid" && (
                          <span className="ml-1.5 text-[11px] font-normal text-success">
                            Paid
                          </span>
                        )}
                        {inst.status === "failed" && (
                          <span className="ml-1.5 text-[11px] font-normal text-rose-600">
                            Failed
                          </span>
                        )}
                        {inst.status === "payment_pending" && (
                          <span className="ml-1.5 text-[11px] font-normal text-warning">
                            Payment pending
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Due{" "}
                        {new Date(inst.dueDate).toLocaleDateString("en-AU", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-foreground">
                      ${Number(inst.amount).toFixed(2)}
                    </p>
                    {inst.status === "pending" &&
                      plan.status === "active" &&
                      cpStatus === "active" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-[11px]"
                            onClick={() => onChangeDate({ plan, index: idx })}
                          >
                            Change Date
                          </Button>
                          {cloverReady && customerID && (
                            <SendPaymentLinkMenu
                              customerID={customerID}
                              target={{
                                kind: "installment",
                                paymentPlanID: plan._id,
                                installmentIndex: idx,
                              }}
                              onSent={onSent}
                            />
                          )}
                          <Button
                            size="sm"
                            className="h-7 px-2.5 text-[11px] bg-success hover:bg-success text-white"
                            onClick={() =>
                              onPayInstallment({
                                plan,
                                index: idx,
                                billingType,
                              })
                            }
                          >
                            Pay
                          </Button>
                        </>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
          {plan.nextPaymentDate && plan.status === "active" && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Next payment due:{" "}
              {new Date(plan.nextPaymentDate).toLocaleDateString("en-AU", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          )}
          {billingType === "flexible" &&
            plan.status !== "cancelled" &&
            cpStatus === "active" && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 h-7 px-3 text-[11px] w-full"
                onClick={() => onAddInstallment(plan)}
              >
                + Add Payment
              </Button>
            )}
        </div>
      )}
    </div>
  );
}

// ─── PaymentTimeline ─────────────────────────────────────────────────────────

function PaymentTimeline({ customerID, enrollmentID }) {
  const [open, setOpen] = useState(false);
  const [payments, setPayments] = useState(null); // null = not yet loaded
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function load() {
    if (payments !== null) return; // already loaded
    setLoading(true);
    const res = await api.get(
      `/api/payment/customer/${customerID}?enrollmentID=${enrollmentID}&limit=100`,
    );
    if (res.success) setPayments(Array.isArray(res.data) ? res.data : []);
    else toast.error("Failed to load payment history");
    setLoading(false);
  }

  function toggle() {
    if (!open) load();
    setOpen((v) => !v);
  }

  const typeLabel = {
    package_purchase: "Payment",
    credit_topup: "Credit Top-up",
    refund: "Refund",
    session_payment: "Session Payment",
    membership_purchase: "Membership Purchase",
    membership_renewal: "Membership Renewal",
  };

  const methodIcon = {
    cash: "💵",
    card: "💳",
    online: "🌐",
    cheque: "📝",
    other: "•",
  };

  return (
    <div className="mt-4 border-t border-border pt-4">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors w-full"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform shrink-0 ${open ? "" : "-rotate-90"}`}
        />
        Payment History
        {payments !== null && (
          <span className="ml-1 normal-case font-normal">
            ({payments.length} record{payments.length !== 1 ? "s" : ""})
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3">
          {loading && (
            <p className="text-[12px] text-muted-foreground py-4 text-center">
              Loading…
            </p>
          )}
          {!loading && payments !== null && payments.length === 0 && (
            <p className="text-[12px] text-muted-foreground py-4 text-center">
              No payment records yet.
            </p>
          )}
          {!loading && payments !== null && payments.length > 0 && (
            <div className="relative pl-5">
              {/* vertical line */}
              <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />

              {payments.map((p, i) => {
                const isRefund = p.type === "refund";
                const date = new Date(p.createdAt);
                return (
                  <div
                    key={p._id}
                    className={`relative mb-3 last:mb-0 ${i === 0 ? "" : ""}`}
                  >
                    {/* dot */}
                    <div
                      className={`absolute -left-3 top-2 h-2.5 w-2.5 rounded-full border-2 border-background shrink-0 ${
                        p.status === "failed"
                          ? "bg-rose-500"
                          : isRefund
                            ? "bg-warning"
                            : "bg-success"
                      }`}
                    />

                    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[12px] font-medium text-foreground">
                              {typeLabel[p.type] ?? p.type}
                            </p>
                            {p.enrollmentID && (
                              <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-border">
                                Enrollment #
                                {p.enrollmentID.enrollmentNumber ?? "—"}
                                {p.enrollmentID.label
                                  ? ` · ${p.enrollmentID.label}`
                                  : ""}
                              </span>
                            )}
                            {p.enrollmentID?.package?.packageName && (
                              <span className="text-[10px] font-medium bg-info/10 text-info px-1.5 py-0.5 rounded border border-info/20">
                                {p.enrollmentID.package.packageName}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {date.toLocaleDateString("en-AU", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                            {" · "}
                            {date.toLocaleTimeString("en-AU", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                            {p.processedBy?.name && ` · ${p.processedBy.name}`}
                          </p>
                          {p.notes && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 italic">
                              {p.notes}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span
                            className={`text-[14px] font-semibold ${
                              isRefund
                                ? "text-warning"
                                : p.status === "failed"
                                  ? "text-rose-600"
                                  : "text-success"
                            }`}
                          >
                            {isRefund ? "−" : "+"}${Number(p.amount).toFixed(2)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] capitalize text-muted-foreground">
                              {methodIcon[p.method] ?? ""} {p.method}
                            </span>
                            {p.status !== "completed" && (
                              <span
                                className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                                  p.status === "failed"
                                    ? "bg-rose-500/10 text-rose-600"
                                    : "bg-warning/10 text-warning"
                                }`}
                              >
                                {p.status}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PayInstallmentDialog ────────────────────────────────────────────────────

function PayInstallmentDialog({
  open,
  onClose,
  plan,
  installmentIndex,
  billingType,
  locationID,
  onSuccess,
}) {
  const [method, setMethod] = useState("cash");
  const [shortfallMethod, setShortfallMethod] = useState("cash");
  const [walletBalance, setWalletBalance] = useState(0);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const { ready: cloverReady } = useCardProcessor(locationID || plan);

  useEffect(() => {
    if (open && plan?.customerID) {
      fetchWalletBalance(plan.customerID?._id ?? plan.customerID).then(
        setWalletBalance,
      );
    }
  }, [open, plan?.customerID]);

  const amountEditable = billingType === "flexible";
  const installment = plan?.installments?.[installmentIndex];

  // When the wallet cannot cover the installment, the shortfall method is what actually
  // reaches Clover — so it, not the wallet, decides whether a checkout tab is needed.
  const paymentFields = walletPaymentFields({
    method,
    shortfallMethod,
    balance: walletBalance,
    amountDue: Number(amount) || 0,
  });
  const payWithClover = paymentFields.method === "card" && cloverReady;
  const cloverNotConnected = paymentFields.method === "card" && !cloverReady;

  useEffect(() => {
    if (installment) setAmount(Number(installment.amount).toFixed(2));
  }, [installment]);

  function validatedAmount() {
    const num = Number(amount);
    if (isNaN(num) || num <= 0) {
      toast.error("Enter a valid amount.");
      return null;
    }
    return num;
  }

  async function submitPayment() {
    const num = validatedAmount();
    if (num === null) return;
    const checkoutTab = payWithClover ? openCheckoutTab() : null;
    setSaving(true);
    const res = await api.post(
      `/api/payment-plan/${plan._id}/pay-installment`,
      {
        installmentIndex,
        amount: num,
        paymentDate: paymentDate || undefined,
        ...walletPaymentFields({
          method,
          shortfallMethod,
          balance: walletBalance,
          amountDue: num,
        }),
      },
    );
    if (res.success) {
      if (res.data?.checkoutUrl) {
        navigateCheckoutTab(checkoutTab, res.data.checkoutUrl);
        toast.success(CHECKOUT_TOAST);
      } else {
        toast.success("Installment payment recorded.");
      }
      onSuccess();
      onClose();
    } else {
      closeCheckoutTab(checkoutTab);
      toast.error(res.error || "Failed to record payment.");
    }
    setSaving(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await submitPayment();
  }

  async function handleSaveAmount() {
    const num = validatedAmount();
    if (num === null) return;
    setSaving(true);
    const res = await api.patch(
      `/api/payment-plan/${plan._id}/installment/${installmentIndex}/due-date`,
      {
        dueDate: new Date(installment.dueDate).toISOString().slice(0, 10),
        amount: num,
      },
    );
    if (res.success) {
      toast.success("Amount updated.");
      onSuccess();
      onClose();
    } else {
      toast.error(res.error || "Failed to update amount.");
    }
    setSaving(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pay Installment</DialogTitle>
        </DialogHeader>
        {installment && (
          <p className="text-[12px] text-muted-foreground -mt-1">
            Payment {installmentIndex + 1} of {plan.numberOfInstallments} ·{" "}
            <span className="text-foreground font-medium">
              ${Number(installment.amount).toFixed(2)}
            </span>{" "}
            due{" "}
            {new Date(installment.dueDate).toLocaleDateString("en-AU", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <FormField label="Amount" required>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              readOnly={!amountEditable}
              disabled={!amountEditable}
              className={`h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary ${
                amountEditable ? "" : "cursor-not-allowed opacity-70"
              }`}
            />
          </FormField>
          <FormField label="Payment Method" required>
            <div className="relative">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[13px] outline-none focus:border-primary capitalize"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
          </FormField>
          <FormField label="Payment date" required>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
            />
          </FormField>
          <WalletShortfallField
            method={method}
            balance={walletBalance}
            amountDue={Number(amount) || 0}
            shortfallMethod={shortfallMethod}
            onShortfallMethodChange={setShortfallMethod}
          />
          {cloverNotConnected && (
            <p className="text-[12px] text-muted-foreground">
              Connect a card processor (Clover or Stripe) in Settings → Integrations to charge a card.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {amountEditable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={handleSaveAmount}
              >
                Save
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={saving || cloverNotConnected}
              className="bg-success hover:bg-success text-white"
            >
              {saving
                ? "Recording…"
                : payWithClover
                  ? "Pay by card"
                  : `Pay $${(Number(amount) || 0).toFixed(2)}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── ChangeInstallmentDateDialog ─────────────────────────────────────────────

function ChangeInstallmentDateDialog({
  open,
  onClose,
  plan,
  installmentIndex,
  onSuccess,
}) {
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const installment = plan?.installments?.[installmentIndex];

  useEffect(() => {
    if (installment) {
      setDueDate(
        installment.dueDate
          ? new Date(installment.dueDate).toISOString().slice(0, 10)
          : "",
      );
    }
  }, [installment]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!dueDate) return;
    setSaving(true);
    const res = await api.patch(
      `/api/payment-plan/${plan._id}/installment/${installmentIndex}/due-date`,
      { dueDate },
    );
    if (res.success) {
      toast.success("Installment updated.");
      onSuccess();
      onClose();
    } else {
      toast.error(res.error || "Failed to update installment.");
    }
    setSaving(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Due Date</DialogTitle>
        </DialogHeader>
        {installment && (
          <p className="text-[12px] text-muted-foreground -mt-1">
            Payment {installmentIndex + 1} of {plan.numberOfInstallments}
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <FormField label="Due Date" required>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !dueDate}
              className="bg-brand hover:opacity-90 text-white"
            >
              {saving ? "Saving…" : "Update"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── AddInstallmentDialog ─────────────────────────────────────────────────────

function AddInstallmentDialog({ open, onClose, plan, onSuccess }) {
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setDueDate("");
      setAmount("");
    }
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!dueDate || !amount) return;
    setSaving(true);
    const res = await api.post(`/api/payment-plan/${plan._id}/installment`, {
      dueDate,
      amount: Number(amount),
    });
    if (res.success) {
      toast.success("Payment added.");
      onSuccess();
      onClose();
    } else {
      toast.error(res.error || "Failed to add payment.");
    }
    setSaving(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Scheduled Payment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <FormField label="Due Date" required>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
            />
          </FormField>
          <FormField label="Amount ($)" required>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !dueDate || !amount}
              className="bg-brand hover:opacity-90 text-white"
            >
              {saving ? "Saving…" : "Add Payment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── SetupPaymentPlanDialog ───────────────────────────────────────────────────
// Schedules NEW going-forward installments against an enrollment's remaining
// balance — for migrated enrollments (which land with a package + a static
// due amount but no billing schedule) and any other one_time enrollment that
// still owes money. Posts to POST /api/customer-package/:enrollmentId/payment-plan.

function SetupPaymentPlanDialog({
  open,
  onClose,
  enrollment,
  outstanding,
  onSuccess,
}) {
  const [numberOfInstallments, setNumberOfInstallments] = useState(3);
  const [frequency, setFrequency] = useState("monthly");
  const [startDate, setStartDate] = useState("");
  const [collectNow, setCollectNow] = useState(false);
  const [method, setMethod] = useState("cash");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setNumberOfInstallments(3);
      setFrequency("monthly");
      setStartDate(new Date().toISOString().slice(0, 10));
      setCollectNow(false);
      setMethod("cash");
    }
  }, [open]);

  const perInstallment =
    outstanding > 0 && numberOfInstallments > 0
      ? (outstanding / numberOfInstallments).toFixed(2)
      : "0.00";

  async function handleSubmit(e) {
    e.preventDefault();
    if (!numberOfInstallments || !frequency || !startDate) return;
    setSaving(true);
    const res = await api.post(
      `/api/customer-package/${enrollment._id}/payment-plan`,
      {
        billing: {
          numberOfInstallments: Number(numberOfInstallments),
          frequency,
          startDate,
          collectNow,
          method,
        },
      },
    );
    if (res.success) {
      toast.success("Payment plan created.");
      onSuccess();
      onClose();
    } else {
      toast.error(res.error || res.message || "Failed to create payment plan.");
    }
    setSaving(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Set Up Payment Plan</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <p className="text-[12px] text-muted-foreground">
            Schedule the remaining{" "}
            <span className="font-semibold text-foreground">
              ${Number(outstanding).toFixed(2)}
            </span>{" "}
            balance into recurring payments.
          </p>
          <FormField label="Number of Installments" required>
            <input
              type="number"
              min="1"
              step="1"
              value={numberOfInstallments}
              onChange={(e) => setNumberOfInstallments(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
            />
          </FormField>
          <FormField label="Frequency" required>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </FormField>
          <FormField label="First Payment Date" required>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
            />
          </FormField>
          {numberOfInstallments > 0 && (
            <p className="text-[12px] text-muted-foreground">
              ≈ ${perInstallment} per installment
            </p>
          )}
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={collectNow}
              onChange={(e) => setCollectNow(e.target.checked)}
            />
            Collect the first installment now
          </label>
          {collectNow && (
            <FormField label="Method">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
              >
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </FormField>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={
                saving || !numberOfInstallments || !frequency || !startDate
              }
              className="bg-brand hover:opacity-90 text-white"
            >
              {saving ? "Saving…" : "Create Plan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Packages Tab ─────────────────────────────────────────────────────────────

const BLANK_ADD_FORM = {
  enrollmentID: "",
  packageID: "",
  purchaseDate: "",
  services: [],
  billingType: "one_time",
  billing: {
    method: "cash",
    numberOfInstallments: 3,
    frequency: "monthly",
    startDate: "",
    dueDate: "",
    initialPayment: "",
    initialPaymentMethod: "cash",
    installmentMode: "count",
    installmentAmount: "",
  },
};

function PackagesTab({ customerID, locationID }) {
  const [customerPkgs, setCustomerPkgs] = useState([]);
  const [detailsMap, setDetailsMap] = useState({});
  const [plansMap, setPlansMap] = useState({}); // cpId -> PaymentPlan doc
  const [allPkgs, setAllPkgs] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);

  // Add package multi-step
  const [addOpen, setAddOpen] = useState(false);
  const [addStep, setAddStep] = useState(1);
  const [addForm, setAddForm] = useState(BLANK_ADD_FORM);
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [adding, setAdding] = useState(false);

  // Cancel / pay / pay-installment
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [extendTarget, setExtendTarget] = useState(null); // { _id, packageName, expiryDate }
  const [extendDate, setExtendDate] = useState("");
  const [extending, setExtending] = useState(false);
  const [payInstallTarget, setPayInstallTarget] = useState(null); // { plan, index }
  const [changeInstallDateTarget, setChangeInstallDateTarget] = useState(null); // { plan, index }
  const toast = useToast();
  const { ready: cloverReady } = useCardProcessor(locationID);

  const load = useCallback(async () => {
    setLoading(true);
    const [pkgRes, allRes, enrRes] = await Promise.all([
      api.get(`/api/customer-package/customer/${customerID}`),
      api.get("/api/package?limit=200&isActive=true"),
      api.get(`/api/enrollment?customerID=${customerID}`),
    ]);
    if (allRes.success) setAllPkgs(allRes.data || []);
    if (enrRes.success) setEnrollments(enrRes.data || []);
    if (pkgRes.success) {
      const list = pkgRes.data || [];
      setCustomerPkgs(list);
      if (list.length > 0) {
        const detailResults = await Promise.all(
          list.map((enr) =>
            api.get(`/api/customer-package/${enr._id}/details`),
          ),
        );
        const detMap = {};
        list.forEach((enr, i) => {
          if (detailResults[i].success)
            detMap[String(enr._id)] = detailResults[i].data;
        });
        setDetailsMap(detMap);

        const hasPlanPkgs = list.some(
          (enr) =>
            enr.package?.billingType === "payment_plan" ||
            enr.package?.billingType === "flexible",
        );
        if (hasPlanPkgs) {
          const plansRes = await api.get(
            `/api/payment-plan/customer/${customerID}`,
          );
          if (plansRes.success) {
            const pm = {};
            (plansRes.data || []).forEach((plan) => {
              const enrId = String(plan.enrollmentID?._id ?? plan.enrollmentID);
              pm[enrId] = plan;
            });
            setPlansMap(pm);
          }
        }
      }
    }
    setLoading(false);
  }, [customerID]);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setAddForm(BLANK_ADD_FORM);
    setSelectedPkg(null);
    setAddStep(1);
    setAddOpen(true);
  }
  function closeAdd() {
    setAddOpen(false);
  }

  function onPkgChange(pkgId) {
    const pkg = allPkgs.find((p) => String(p._id) === pkgId);
    setSelectedPkg(pkg || null);
    setAddForm((f) => ({
      ...f,
      packageID: pkgId,
      services: (pkg?.services || []).map((s) => {
        const isChargeable = s.isChargeable ?? true;
        const pricePerSession = isChargeable ? s.pricePerSession || 0 : 0;
        const numberOfSessions = s.numberOfSessions || 0;
        const gross = numberOfSessions * pricePerSession;
        const discountType = isChargeable ? s.discountType || "none" : "none";
        const discountAmount = isChargeable ? Number(s.discountAmount || 0) : 0;
        let finalAmount = gross;
        if (discountType === "percentage")
          finalAmount = Math.max(0, gross - (gross * discountAmount) / 100);
        else if (discountType === "fixed")
          finalAmount = Math.max(0, gross - discountAmount);
        return {
          serviceCode: s.serviceCode || "",
          serviceName: s.serviceName || "",
          color: s.color || "",
          numberOfSessions,
          pricePerSession,
          discountType,
          discountAmount,
          finalAmount: parseFloat(finalAmount.toFixed(2)),
          isChargeable,
        };
      }),
    }));
  }

  function updateSvc(i, field, val) {
    setAddForm((f) => {
      const svcs = f.services.map((s, idx) => {
        if (idx !== i) return s;
        const updated = { ...s, [field]: val };
        const gross =
          (Number(updated.pricePerSession) || 0) *
          (Number(updated.numberOfSessions) || 0);
        const discAmt = Number(updated.discountAmount) || 0;
        let finalAmount = gross;
        if (updated.discountType === "percentage")
          finalAmount = Math.max(0, gross - (gross * discAmt) / 100);
        else if (updated.discountType === "fixed")
          finalAmount = Math.max(0, gross - discAmt);
        updated.finalAmount = parseFloat(finalAmount.toFixed(2));
        return updated;
      });
      return { ...f, services: svcs };
    });
  }

  function setBilling(field, val) {
    setAddForm((f) => ({ ...f, billing: { ...f.billing, [field]: val } }));
  }

  const totalAmount = addForm.services.reduce(
    (s, svc) => s + (Number(svc.finalAmount) || 0),
    0,
  );
  const totalDiscount = addForm.services.reduce((s, svc) => {
    const gross =
      (Number(svc.pricePerSession) || 0) * (Number(svc.numberOfSessions) || 0);
    return s + Math.max(0, gross - (Number(svc.finalAmount) || 0));
  }, 0);

  // Only one-time billing settles money in this dialog; the other types collect later.
  const payWithClover =
    addForm.billingType === "one_time" &&
    addForm.billing.method === "card" &&
    totalAmount > 0 &&
    cloverReady;
  const cloverNotConnected =
    addForm.billingType === "one_time" &&
    addForm.billing.method === "card" &&
    totalAmount > 0 &&
    !cloverReady;

  function getInstallments() {
    const { numberOfInstallments, frequency, startDate } = addForm.billing;
    if (!startDate || !numberOfInstallments) return [];
    const n = Number(numberOfInstallments);
    if (!n || n < 1) return [];
    const baseAmt = parseFloat((totalAmount / n).toFixed(2));
    const result = [];
    let d = new Date(startDate);
    for (let i = 0; i < n; i++) {
      const isLast = i === n - 1;
      const amount = isLast
        ? Math.max(0, parseFloat((totalAmount - baseAmt * (n - 1)).toFixed(2)))
        : baseAmt;
      result.push({
        date: d.toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        amount,
      });
      if (frequency === "weekly") d = new Date(d.getTime() + 7 * 86400000);
      else if (frequency === "biweekly")
        d = new Date(d.getTime() + 14 * 86400000);
      else {
        d = new Date(d);
        d.setMonth(d.getMonth() + 1);
      }
    }
    return result;
  }

  async function handleAdd() {
    if (!addForm.enrollmentID) {
      toast.error("Please select an enrollment.");
      return;
    }
    if (addForm.billingType === "payment_plan") {
      const { numberOfInstallments, frequency, startDate } = addForm.billing;
      if (!numberOfInstallments || !frequency || !startDate) {
        toast.error("Please fill all payment plan fields.");
        return;
      }
    }
    const checkoutTab = payWithClover ? openCheckoutTab() : null;
    setAdding(true);
    const payload = {
      customerID,
      packageID: addForm.packageID,
      enrollmentID: addForm.enrollmentID,
      services: addForm.services.map((s) => ({
        serviceCode: s.serviceCode,
        serviceName: s.serviceName,
        color: s.color,
        numberOfSessions: Number(s.numberOfSessions),
        pricePerSession: Number(s.pricePerSession),
        discountType: s.discountType || "none",
        discountAmount: Number(s.discountAmount || 0),
        finalAmount: Number(s.finalAmount),
      })),
      billingType: addForm.billingType,
      billing:
        addForm.billingType === "one_time"
          ? { method: addForm.billing.method }
          : addForm.billingType === "payment_plan"
            ? {
                numberOfInstallments: Number(
                  addForm.billing.numberOfInstallments,
                ),
                frequency: addForm.billing.frequency,
                startDate: addForm.billing.startDate,
              }
            : {},
    };
    if (addForm.purchaseDate) payload.purchaseDate = addForm.purchaseDate;
    const res = await api.post("/api/customer-package/add", payload);
    if (res.success) {
      if (res.data?.checkoutUrl) {
        navigateCheckoutTab(checkoutTab, res.data.checkoutUrl);
        toast.success(CHECKOUT_TOAST);
      } else {
        closeCheckoutTab(checkoutTab);
        toast.success("Package added to customer.");
      }
      closeAdd();
      load();
    } else {
      closeCheckoutTab(checkoutTab);
      toast.error(res.error || "Failed to add package.");
    }
    setAdding(false);
  }

  async function handleCancel(refundOption, refundAmount) {
    if (!cancelTarget) return;
    setCancelling(true);
    const res = await api.patch(
      `/api/customer-package/${cancelTarget._id}/cancel`,
      { refundOption, refundAmount },
    );
    if (res.success) {
      toast.success("Package cancelled.");
      setCancelTarget(null);
      load();
    } else toast.error(res.error || "Failed to cancel.");
    setCancelling(false);
  }

  async function handleExtend() {
    if (!extendTarget || !extendDate) return;
    setExtending(true);
    const res = await api.put(
      `/api/enrollment/${extendTarget._id}/extend-expiry`,
      { expiryDate: extendDate },
    );
    if (res.success) {
      toast.success("Expiry date extended.");
      setExtendTarget(null);
      setExtendDate("");
      load();
    } else toast.error(res.error || "Failed to extend expiry.");
    setExtending(false);
  }

  if (loading)
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner />
      </div>
    );

  const installments = getInstallments();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          {customerPkgs.length} package{customerPkgs.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" className="h-8 text-[12px]" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Package
        </Button>
      </div>

      {customerPkgs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center text-[13px] text-muted-foreground">
          No packages yet. Click "Add Package" to assign one.
        </div>
      ) : (
        <div className="space-y-3">
          {customerPkgs.map((enr) => {
            const pkg = enr.package ?? {};
            const det = detailsMap[String(enr._id)];
            const billing = det?.billing ?? {};
            const services = det?.services ?? pkg.services ?? [];
            const totalPaid = billing.totalPaid ?? pkg.totalPaid ?? 0;
            const collected =
              billing.amountCollected ?? pkg.amountCollected ?? 0;
            const outstanding =
              billing.outstanding ?? Math.max(0, totalPaid - collected);
            const refunded = billing.totalRefunded ?? 0;
            return (
              <div
                key={enr._id}
                className="rounded-xl border border-border bg-card p-5"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {pkg.packageRef?.color && (
                      <div
                        className="h-9 w-9 rounded-lg shrink-0 border border-black/10"
                        style={{ backgroundColor: pkg.packageRef.color }}
                      />
                    )}
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">
                        {enrollmentDisplayName(enr) || "Package"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Purchased {formatDate(pkg.purchaseDate)}
                        {pkg.expiryDate
                          ? ` · Expires ${formatDate(pkg.expiryDate)}`
                          : " · No expiry"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
                    {pkg.billingType && pkg.billingType !== "one_time" && (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-violet-500/10 text-violet-600 capitalize">
                        {pkg.billingType.replace("_", " ")}
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${paymentStatusColor(pkg.paymentStatus)}`}
                    >
                      {paymentStatusLabel(pkg.paymentStatus)}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusColor(pkg.status)}`}
                    >
                      {pkg.status}
                    </span>
                    {pkg.status !== "cancelled" && pkg.expiryDate && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-[11px] font-medium"
                        onClick={() => {
                          const d = pkg.expiryDate
                            ? new Date(pkg.expiryDate)
                                .toISOString()
                                .slice(0, 10)
                            : "";
                          setExtendDate(d);
                          setExtendTarget({
                            _id: enr._id,
                            packageName: pkg.packageName,
                          });
                        }}
                      >
                        Extend
                      </Button>
                    )}
                    {pkg.status === "active" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-[11px] font-medium border-destructive/40 text-destructive hover:bg-destructive/10"
                        onClick={() =>
                          setCancelTarget({
                            _id: enr._id,
                            packageName: pkg.packageName,
                            maxRefundable: Math.max(0, collected - refunded),
                          })
                        }
                      >
                        <X className="h-3 w-3 mr-1" /> Cancel
                      </Button>
                    )}
                  </div>
                </div>

                {/* Billing summary — 4 columns */}
                <div className="mt-4 grid grid-cols-4 gap-3 rounded-lg bg-muted/40 p-3">
                  {[
                    {
                      label: "Total Price",
                      value: `$${Number(totalPaid).toFixed(2)}`,
                    },
                    {
                      label: "Collected",
                      value: `$${Number(collected).toFixed(2)}`,
                      cls: "text-success",
                    },
                    {
                      label: "Outstanding",
                      value: `$${Number(outstanding).toFixed(2)}`,
                      cls:
                        outstanding > 0
                          ? "text-rose-600"
                          : "text-muted-foreground",
                    },
                    {
                      label: "Refunded",
                      value: `$${Number(refunded).toFixed(2)}`,
                      cls:
                        refunded > 0 ? "text-warning" : "text-muted-foreground",
                    },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className="text-center">
                      <p className="text-[10px] text-muted-foreground mb-0.5">
                        {label}
                      </p>
                      <p
                        className={`text-[13px] font-semibold ${cls ?? "text-foreground"}`}
                      >
                        {value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Chasing an outstanding balance is the moment this is wanted, so the
                    action sits where the balance is read. */}
                {outstanding > 0 && cloverReady && (
                  <div className="mt-2 flex justify-end">
                    <SendPaymentLinkMenu
                      customerID={customerID}
                      target={{ kind: "package", enrollmentID: enr._id }}
                      onSent={load}
                    />
                  </div>
                )}

                {/* Services with full session breakdown */}
                {services.length > 0 && (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2.5">
                      Services
                    </p>
                    <div className="space-y-2.5">
                      {services.map((svc, i) => {
                        const sessTotal = svc.sessionsTotal ?? 0;
                        const sessSched = svc.sessionsScheduled ?? 0;
                        // `sessionsCompleted` (real CalendarEvent charge
                        // history) is ALWAYS a number, never null/undefined —
                        // `??` alone would silently bury `sessionsUsed` (e.g.
                        // an imported package's Sessions Taken count with no
                        // accompanying Lessons-sheet history) behind a 0
                        // forever. But `sessionsUsed` is the backend's raw
                        // booking-time counter — it already counts every
                        // still-scheduled (not yet completed) session too, so
                        // subtract sessSched before taking the floor, or a
                        // normal (non-imported) package double-counts its
                        // live-scheduled sessions as both "completed" (via
                        // this fallback) and "scheduled". Only the portion of
                        // sessionsUsed that sessSched can't already explain —
                        // i.e. genuinely pre-existing/imported usage with no
                        // CalendarEvent behind it — should raise the floor.
                        const sessUsed = Math.max(
                          svc.sessionsCompleted ?? 0,
                          (svc.sessionsUsed ?? 0) - sessSched,
                        );
                        const sessRemaining = Math.max(
                          0,
                          sessTotal - sessUsed - sessSched,
                        );
                        const pps = Number(svc.pricePerSession) || 0;
                        const effectivePps =
                          sessTotal > 0 && svc.finalAmount > 0
                            ? Number(svc.finalAmount) / sessTotal
                            : pps;
                        const svcTotal = sessTotal * pps;
                        return (
                          <div
                            key={i}
                            className="rounded-lg border border-border/60 bg-background p-3"
                          >
                            <div className="flex items-center gap-2 mb-2.5">
                              {svc.color && (
                                <span
                                  className="h-3 w-3 rounded-full shrink-0 border border-black/10"
                                  style={{ backgroundColor: svc.color }}
                                />
                              )}
                              <p className="text-[12px] font-medium text-foreground flex-1">
                                {svc.serviceName}
                              </p>
                              {svc.pricePerSession > 0 && (
                                <span className="text-[11px] text-muted-foreground">
                                  ${Number(svc.pricePerSession).toFixed(2)}
                                  /session
                                </span>
                              )}
                              {svcTotal > 0 && (
                                <span className="text-[12px] font-semibold text-foreground">
                                  ${svcTotal.toFixed(2)}
                                </span>
                              )}
                            </div>
                            {/* Session counts — 4 boxes */}
                            <div className="grid grid-cols-4 gap-1.5 mb-2">
                              {[
                                { label: "Total", value: sessTotal },
                                {
                                  label: "Completed",
                                  value: sessUsed,
                                  cls: sessUsed > 0 ? "text-info" : "",
                                },
                                {
                                  label: "Scheduled",
                                  value: sessSched,
                                  cls: sessSched > 0 ? "text-violet-600" : "",
                                },
                                {
                                  label: "Remaining",
                                  value: sessRemaining,
                                  cls:
                                    sessRemaining > 0
                                      ? "text-success"
                                      : "text-muted-foreground",
                                },
                              ].map(({ label, value, cls }) => (
                                <div
                                  key={label}
                                  className="text-center bg-muted/40 rounded-md py-1.5"
                                >
                                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
                                    {label}
                                  </p>
                                  <p
                                    className={`text-[14px] font-bold ${cls ?? "text-foreground"}`}
                                  >
                                    {value}
                                  </p>
                                </div>
                              ))}
                            </div>
                            <SessionBar used={sessUsed} total={sessTotal} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Payment plan / scheduled-flexible installment schedule */}
                {(() => {
                  const plan = plansMap[String(enr._id)];
                  if (!plan) return null;
                  const paidCount = plan.installments.filter(
                    (i) => i.status === "paid",
                  ).length;
                  return (
                    <div className="mt-4 border-t border-border pt-4">
                      <div className="flex items-center justify-between mb-2.5">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Payment Schedule
                        </p>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              plan.status === "completed"
                                ? "bg-success/10 text-success"
                                : plan.status === "cancelled"
                                  ? "bg-muted text-muted-foreground"
                                  : "bg-violet-500/10 text-violet-600"
                            }`}
                          >
                            {plan.status}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {paidCount} / {plan.numberOfInstallments} paid
                          </span>
                        </div>
                      </div>
                      <div className="rounded-lg border border-border overflow-hidden">
                        {plan.installments.map((inst, idx) => {
                          const isLast = idx === plan.installments.length - 1;
                          const hasDiscount =
                            isLast && plan.installmentAmount > inst.amount;
                          return (
                            <div
                              key={idx}
                              className={`flex items-center justify-between px-3 py-2.5 ${idx > 0 ? "border-t border-border" : ""} ${
                                inst.status === "paid" ? "bg-success/5" : ""
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <div
                                  className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
                                    inst.status === "paid"
                                      ? "bg-success text-white"
                                      : inst.status === "failed"
                                        ? "bg-rose-600 text-white"
                                        : inst.status === "payment_pending"
                                          ? "bg-warning text-white"
                                          : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {inst.status === "paid" ? "✓" : idx + 1}
                                </div>
                                <div>
                                  <p className="text-[12px] text-foreground font-medium">
                                    Payment {idx + 1}
                                    {inst.status === "paid" && (
                                      <span className="ml-1.5 text-[11px] font-normal text-success">
                                        Paid
                                      </span>
                                    )}
                                    {inst.status === "failed" && (
                                      <span className="ml-1.5 text-[11px] font-normal text-rose-600">
                                        Failed
                                      </span>
                                    )}
                                    {inst.status === "payment_pending" && (
                                      <span className="ml-1.5 text-[11px] font-normal text-warning">
                                        Payment pending
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground">
                                    Due{" "}
                                    {new Date(inst.dueDate).toLocaleDateString(
                                      "en-AU",
                                      {
                                        day: "numeric",
                                        month: "short",
                                        year: "numeric",
                                      },
                                    )}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {hasDiscount && (
                                  <span className="text-[11px] text-muted-foreground line-through">
                                    ${Number(plan.installmentAmount).toFixed(2)}
                                  </span>
                                )}
                                <p className="text-[13px] font-semibold text-foreground">
                                  ${Number(inst.amount).toFixed(2)}
                                </p>
                                {hasDiscount && (
                                  <span className="text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded-full">
                                    discount
                                  </span>
                                )}
                                {inst.status === "pending" &&
                                  plan.status === "active" &&
                                  pkg.status === "active" && (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2.5 text-[11px]"
                                        onClick={() =>
                                          setChangeInstallDateTarget({
                                            plan,
                                            index: idx,
                                          })
                                        }
                                      >
                                        Change Date
                                      </Button>
                                      {cloverReady && (
                                        <SendPaymentLinkMenu
                                          customerID={customerID}
                                          target={{
                                            kind: "installment",
                                            paymentPlanID: plan._id,
                                            installmentIndex: idx,
                                          }}
                                          onSent={load}
                                        />
                                      )}
                                      <Button
                                        size="sm"
                                        className="h-7 px-2.5 text-[11px] bg-success hover:bg-success text-white"
                                        onClick={() =>
                                          setPayInstallTarget({
                                            plan,
                                            index: idx,
                                            billingType: pkg.billingType,
                                          })
                                        }
                                      >
                                        Pay
                                      </Button>
                                    </>
                                  )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {plan.nextPaymentDate && plan.status === "active" && (
                        <p className="text-[11px] text-muted-foreground mt-1.5">
                          Next payment due:{" "}
                          {new Date(plan.nextPaymentDate).toLocaleDateString(
                            "en-AU",
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            },
                          )}
                        </p>
                      )}
                    </div>
                  );
                })()}

                <PaymentTimeline
                  customerID={customerID}
                  enrollmentID={String(enr._id)}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Pay installment dialog */}
      <PayInstallmentDialog
        open={Boolean(payInstallTarget)}
        onClose={() => setPayInstallTarget(null)}
        plan={payInstallTarget?.plan}
        installmentIndex={payInstallTarget?.index}
        billingType={payInstallTarget?.billingType}
        locationID={locationID}
        onSuccess={load}
      />

      {/* Change installment date dialog */}
      <ChangeInstallmentDateDialog
        open={Boolean(changeInstallDateTarget)}
        onClose={() => setChangeInstallDateTarget(null)}
        plan={changeInstallDateTarget?.plan}
        installmentIndex={changeInstallDateTarget?.index}
        onSuccess={load}
      />

      {/* Cancel confirm */}
      <CancelRefundDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title="Cancel Package"
        itemName={cancelTarget?.packageName}
        maxRefundable={cancelTarget?.maxRefundable ?? 0}
        submitting={cancelling}
        onConfirm={handleCancel}
      />

      {/* Extend expiry */}
      <Dialog
        open={Boolean(extendTarget)}
        onOpenChange={(v) => {
          if (!v) {
            setExtendTarget(null);
            setExtendDate("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Extend Package Expiry</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground mt-1">
            Set a new expiry date for{" "}
            <span className="font-semibold text-foreground">
              {extendTarget?.packageName}
            </span>
            . If the new date is in the future the package will be reactivated.
          </p>
          <div className="mt-4">
            <label className="text-[12px] font-medium text-foreground block mb-1">
              New Expiry Date
            </label>
            <input
              type="date"
              value={extendDate}
              onChange={(e) => setExtendDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setExtendTarget(null);
                setExtendDate("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={extending || !extendDate}
              onClick={handleExtend}
            >
              {extending ? "Saving…" : "Extend Expiry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Package — 3-step dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(v) => {
          if (!v) closeAdd();
        }}
      >
        <DialogContent className={addStep === 2 ? "max-w-3xl" : "max-w-lg"}>
          <DialogHeader>
            <DialogTitle>Add Package</DialogTitle>
            {/* Step progress bar */}
            <div className="flex gap-1 mt-2">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={`h-1 flex-1 rounded-full transition-colors ${s <= addStep ? "bg-primary" : "bg-muted"}`}
                />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {addStep === 1
                ? "Step 1 of 3 — Choose package"
                : addStep === 2
                  ? "Step 2 of 3 — Configure services & pricing"
                  : "Step 3 of 3 — Set billing"}
            </p>
          </DialogHeader>

          {/* ── Step 1: Choose package ── */}
          {addStep === 1 && (
            <div className="space-y-4 mt-2">
              <FormField label="Enrollment" required>
                <div className="relative">
                  <select
                    value={addForm.enrollmentID}
                    onChange={(e) =>
                      setAddForm((f) => ({
                        ...f,
                        enrollmentID: e.target.value,
                      }))
                    }
                    className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[13px] outline-none focus:border-primary"
                  >
                    <option value="">Select enrollment…</option>
                    {enrollments
                      .filter((e) => !e.package)
                      .map((e) => {
                        const ordinal =
                          ["1st", "2nd", "3rd"][e.enrollmentNumber - 1] ??
                          `${e.enrollmentNumber}th`;
                        return (
                          <option key={e._id} value={e._id}>
                            {ordinal} Enrollment{e.label ? ` — ${e.label}` : ""}
                          </option>
                        );
                      })}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
                {enrollments.filter((e) => !e.package).length === 0 && (
                  <p className="text-[11px] text-warning mt-1">
                    No active enrollments without a package. Create an
                    enrollment first in the Enrollments tab.
                  </p>
                )}
              </FormField>
              <FormField label="Package" required>
                <div className="relative">
                  <select
                    value={addForm.packageID}
                    onChange={(e) => onPkgChange(e.target.value)}
                    className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[13px] outline-none focus:border-primary"
                  >
                    <option value="">Select package…</option>
                    {allPkgs.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.packageName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              </FormField>
              {selectedPkg && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                  <p className="text-[12px] font-medium text-foreground">
                    {selectedPkg.packageName}
                  </p>
                  {selectedPkg.description && (
                    <p className="text-[11px] text-muted-foreground">
                      {selectedPkg.description}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {selectedPkg.services?.length ?? 0} service
                    {selectedPkg.services?.length !== 1 ? "s" : ""}
                    {" · "}
                    {selectedPkg.totalDays > 0
                      ? `${selectedPkg.totalDays} days validity`
                      : "No expiry"}
                  </p>
                </div>
              )}
              <FormField label="Purchase date (optional)">
                <input
                  type="date"
                  value={addForm.purchaseDate}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, purchaseDate: e.target.value }))
                  }
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                />
              </FormField>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeAdd}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!addForm.packageID || !addForm.enrollmentID}
                  onClick={() => setAddStep(2)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 2: Configure services ── */}
          {addStep === 2 && (
            <div className="space-y-4 mt-2">
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border">
                      {[
                        "Service",
                        "Color",
                        "Sessions",
                        "Price / Session",
                        "Discount",
                        "Total",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {addForm.services.map((svc, i) => (
                      <tr
                        key={i}
                        className={i > 0 ? "border-t border-border" : ""}
                      >
                        <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">
                          {svc.serviceName}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="color"
                            value={svc.color || "#6366f1"}
                            onChange={(e) =>
                              updateSvc(i, "color", e.target.value)
                            }
                            className="h-7 w-9 rounded border border-border cursor-pointer p-0.5 bg-background"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            value={svc.numberOfSessions}
                            onChange={(e) =>
                              updateSvc(i, "numberOfSessions", e.target.value)
                            }
                            className="h-7 w-16 rounded border border-border bg-background px-2 text-[12px] outline-none focus:border-primary"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                              $
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={
                                svc.isChargeable === false
                                  ? 0
                                  : svc.pricePerSession
                              }
                              disabled={svc.isChargeable === false}
                              onChange={(e) =>
                                updateSvc(i, "pricePerSession", e.target.value)
                              }
                              className={`h-7 w-20 rounded border pl-5 pr-2 text-[12px] outline-none ${svc.isChargeable === false ? "border-border bg-muted/30 text-muted-foreground cursor-not-allowed" : "border-border bg-background focus:border-primary"}`}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <select
                              value={svc.discountType}
                              onChange={(e) =>
                                updateSvc(i, "discountType", e.target.value)
                              }
                              className="h-7 rounded border border-border bg-background px-1 text-[11px] outline-none focus:border-primary"
                            >
                              <option value="none">—</option>
                              <option value="percentage">%</option>
                              <option value="fixed">$</option>
                            </select>
                            {svc.discountType !== "none" && (
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={svc.discountAmount}
                                onChange={(e) =>
                                  updateSvc(i, "discountAmount", e.target.value)
                                }
                                className="h-7 w-16 rounded border border-border bg-background px-2 text-[11px] outline-none focus:border-primary"
                              />
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">
                          ${Number(svc.finalAmount).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {totalDiscount > 0 && (
                      <tr className="border-t border-border bg-muted/20">
                        <td
                          colSpan={5}
                          className="px-3 py-2 text-[11px] font-medium text-muted-foreground text-right"
                        >
                          Discount
                        </td>
                        <td className="px-3 py-2 text-[11px] font-medium text-warning">
                          -${totalDiscount.toFixed(2)}
                        </td>
                      </tr>
                    )}
                    <tr className="border-t border-border bg-muted/30">
                      <td
                        colSpan={5}
                        className="px-3 py-2 text-[11px] font-medium text-muted-foreground text-right"
                      >
                        Total
                      </td>
                      <td className="px-3 py-2 text-[12px] font-semibold text-foreground">
                        ${totalAmount.toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex justify-between gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAddStep(1)}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={addForm.services.length === 0}
                  onClick={() => setAddStep(3)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Billing ── */}
          {addStep === 3 && (
            <div className="space-y-4 mt-2">
              {/* Billing type selector */}
              <div>
                <p className="text-[12px] font-medium text-muted-foreground mb-2">
                  Billing Type
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    {
                      value: "one_time",
                      label: "One-time",
                      desc: "Full payment now",
                    },
                    {
                      value: "payment_plan",
                      label: "Payment Plan",
                      desc: "Autopay installments",
                    },
                    {
                      value: "flexible",
                      label: "Flexible",
                      desc: "Pay as you go",
                    },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        setAddForm((f) => ({ ...f, billingType: opt.value }))
                      }
                      className={`rounded-lg border-2 p-3 text-left transition-colors ${
                        addForm.billingType === opt.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-border/80 bg-background"
                      }`}
                    >
                      <p className="text-[12px] font-semibold text-foreground">
                        {opt.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {opt.desc}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* One-time */}
              {addForm.billingType === "one_time" && (
                <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] text-muted-foreground">
                      Billing Date
                    </p>
                    <p className="text-[12px] font-medium text-foreground">
                      {addForm.purchaseDate
                        ? new Date(addForm.purchaseDate).toLocaleDateString(
                            "en-AU",
                            { day: "numeric", month: "short", year: "numeric" },
                          )
                        : new Date().toLocaleDateString("en-AU", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                    </p>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-3">
                    <p className="text-[12px] text-muted-foreground">
                      Payable Balance
                    </p>
                    <p className="text-[15px] font-bold text-foreground">
                      ${totalAmount.toFixed(2)}
                    </p>
                  </div>
                  <FormField label="Payment Method" required>
                    <div className="relative">
                      <select
                        value={addForm.billing.method}
                        onChange={(e) => setBilling("method", e.target.value)}
                        className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[13px] outline-none focus:border-primary capitalize"
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </FormField>
                  {cloverNotConnected && (
                    <p className="text-[12px] text-muted-foreground">
                      Connect a card processor (Clover or Stripe) in Settings → Integrations to charge a card.
                    </p>
                  )}
                </div>
              )}

              {/* Payment plan */}
              {addForm.billingType === "payment_plan" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <FormField label="Installments" required>
                      <input
                        type="number"
                        min="2"
                        max="52"
                        value={addForm.billing.numberOfInstallments}
                        onChange={(e) =>
                          setBilling("numberOfInstallments", e.target.value)
                        }
                        className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                      />
                    </FormField>
                    <FormField label="Frequency" required>
                      <div className="relative">
                        <select
                          value={addForm.billing.frequency}
                          onChange={(e) =>
                            setBilling("frequency", e.target.value)
                          }
                          className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[13px] outline-none focus:border-primary"
                        >
                          <option value="weekly">Weekly</option>
                          <option value="biweekly">Biweekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </FormField>
                    <FormField label="Start Date" required>
                      <input
                        type="date"
                        value={addForm.billing.startDate}
                        onChange={(e) =>
                          setBilling("startDate", e.target.value)
                        }
                        className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                      />
                    </FormField>
                  </div>
                  {installments.length > 0 && (
                    <div className="rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Schedule Preview
                        </p>
                        {totalDiscount > 0 && (
                          <span className="text-[11px] text-warning">
                            ${totalDiscount.toFixed(2)} discount spread across
                            payments
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                        {installments.map((inst, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between py-1 border-b border-border/30 last:border-0"
                          >
                            <span className="text-[11px] text-muted-foreground">
                              Payment {i + 1} · {inst.date}
                            </span>
                            <span className="text-[11px] font-medium text-foreground">
                              ${inst.amount.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                        <p className="text-[11px] font-medium text-muted-foreground">
                          Payable Balance
                        </p>
                        <p className="text-[13px] font-bold text-foreground">
                          ${totalAmount.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Flexible */}
              {addForm.billingType === "flexible" && (
                <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
                  <p className="text-[12px] text-muted-foreground">
                    No schedule set. Payments can be recorded manually at any
                    time.
                  </p>
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <p className="text-[12px] text-muted-foreground">
                      Payable Balance
                    </p>
                    <p className="text-[15px] font-bold text-foreground">
                      ${totalAmount.toFixed(2)}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-between gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAddStep(2)}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={adding || cloverNotConnected}
                  onClick={() => handleAdd()}
                >
                  {adding
                    ? "Adding…"
                    : payWithClover
                      ? "Pay by card"
                      : "Add Package"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Enrollments Tab ─────────────────────────────────────────────────────────

const BLANK_ENR_FORM = {
  packageID: "",
  purchaseDate: "",
  services: [],
  billingType: "one_time",
  billing: {
    method: "cash",
    numberOfInstallments: 3,
    installmentMode: "count",
    installmentAmount: "",
    frequency: "monthly",
    startDate: "",
  },
};

function EnrollmentsTab({ customerID, customerName = "", locationID }) {
  const [statusFilter, setStatusFilter] = useState("active");
  const [enrollments, setEnrollments] = useState([]);
  const [detailsMap, setDetailsMap] = useState({});
  const [plansMap, setPlansMap] = useState({});
  const [allPkgs, setAllPkgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEnrId, setSelectedEnrId] = useState(null);

  const [createEnrollmentOpen, setCreateEnrollmentOpen] = useState(false);

  const [addTargetEnrollment, setAddTargetEnrollment] = useState(null);
  const [addStep, setAddStep] = useState(1);
  const [addForm, setAddForm] = useState(BLANK_ENR_FORM);
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [adding, setAdding] = useState(false);
  const { ready: cloverReady } = useCardProcessor(locationID);

  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [extendTarget, setExtendTarget] = useState(null);
  const [extendDate, setExtendDate] = useState("");
  const [extending, setExtending] = useState(false);
  const [payInstallTarget, setPayInstallTarget] = useState(null);
  const [changeInstallDateTarget, setChangeInstallDateTarget] = useState(null);
  const [addInstallTarget, setAddInstallTarget] = useState(null);
  const [setupPlanTarget, setSetupPlanTarget] = useState(null); // { enrollment, outstanding }
  const [expandedServices, setExpandedServices] = useState(new Set());
  const [calendarEvents, setCalendarEvents] = useState([]);

  function toggleService(key) {
    setExpandedServices((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const [enrRes, allRes, calRes] = await Promise.all([
      api.get(`/api/enrollment?customerID=${customerID}`),
      api.get("/api/package?limit=200&isActive=true"),
      api.get(`/api/calendar/customer/${customerID}`),
    ]);
    if (calRes.success && Array.isArray(calRes.data))
      setCalendarEvents(calRes.data);
    if (allRes.success) setAllPkgs(allRes.data || []);
    if (enrRes.success) {
      const list = enrRes.data || [];
      setEnrollments(list);
      if (list.length > 0)
        setSelectedEnrId((prev) => prev ?? String(list[list.length - 1]._id));
      const withPkg = list.filter((e) => e.package);
      if (withPkg.length > 0) {
        const detResults = await Promise.all(
          withPkg.map((e) => api.get(`/api/customer-package/${e._id}/details`)),
        );
        const detMap = {};
        withPkg.forEach((e, i) => {
          if (detResults[i].success) detMap[String(e._id)] = detResults[i].data;
        });
        setDetailsMap(detMap);
        const hasPlan = withPkg.some(
          (e) =>
            e.package?.billingType === "payment_plan" ||
            e.package?.billingType === "flexible",
        );
        if (hasPlan) {
          const plansRes = await api.get(
            `/api/payment-plan/customer/${customerID}`,
          );
          if (plansRes.success) {
            const pm = {};
            (plansRes.data || []).forEach((plan) => {
              const enrId = String(plan.enrollmentID?._id ?? plan.enrollmentID);
              pm[enrId] = plan;
            });
            setPlansMap(pm);
          }
        }
      }
    }
    setLoading(false);
  }, [customerID]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreateAndAddFlow() {
    setCreateEnrollmentOpen(true);
  }

  function openAddPackage(enrollment) {
    setAddTargetEnrollment(enrollment);
    setAddForm(BLANK_ENR_FORM);
    setSelectedPkg(null);
    setAddStep(1);
  }

  function onEnrPkgChange(pkgId) {
    const pkg = allPkgs.find((p) => String(p._id) === pkgId);
    setSelectedPkg(pkg || null);
    setAddForm((f) => ({
      ...f,
      packageID: pkgId,
      services: (pkg?.services || []).map((s) => {
        const gross = (s.numberOfSessions || 0) * (s.pricePerSession || 0);
        const discountType = s.discountType || "none";
        const discountAmount = Number(s.discountAmount || 0);
        let finalAmount = gross;
        if (discountType === "percentage")
          finalAmount = Math.max(0, gross - (gross * discountAmount) / 100);
        else if (discountType === "fixed")
          finalAmount = Math.max(0, gross - discountAmount);
        return {
          serviceCode: s.serviceCode || "",
          serviceName: s.serviceName || "",
          color: s.color || "",
          numberOfSessions: s.numberOfSessions || 0,
          pricePerSession: s.pricePerSession || 0,
          discountType,
          discountAmount,
          finalAmount: parseFloat(finalAmount.toFixed(2)),
        };
      }),
    }));
  }

  function updateEnrSvc(i, field, val) {
    setAddForm((f) => {
      const svcs = f.services.map((s, idx) => {
        if (idx !== i) return s;
        const updated = { ...s, [field]: val };
        const gross =
          (Number(updated.pricePerSession) || 0) *
          (Number(updated.numberOfSessions) || 0);
        const discAmt = Number(updated.discountAmount) || 0;
        let finalAmount = gross;
        if (updated.discountType === "percentage")
          finalAmount = Math.max(0, gross - (gross * discAmt) / 100);
        else if (updated.discountType === "fixed")
          finalAmount = Math.max(0, gross - discAmt);
        updated.finalAmount = parseFloat(finalAmount.toFixed(2));
        return updated;
      });
      return { ...f, services: svcs };
    });
  }

  function addEnrSvcRow() {
    setAddForm((f) => ({
      ...f,
      services: [
        ...f.services,
        {
          serviceCode: "",
          serviceName: "",
          color: "",
          numberOfSessions: 0,
          pricePerSession: 0,
          discountType: "none",
          discountAmount: 0,
          finalAmount: 0,
        },
      ],
    }));
  }

  function removeEnrSvcRow(i) {
    setAddForm((f) => ({
      ...f,
      services: f.services.filter((_, idx) => idx !== i),
    }));
  }

  function setEnrBilling(field, val) {
    setAddForm((f) => ({ ...f, billing: { ...f.billing, [field]: val } }));
  }

  const enrTotalAmount = addForm.services.reduce(
    (s, svc) => s + (Number(svc.finalAmount) || 0),
    0,
  );
  const enrTotalDiscount = addForm.services.reduce((s, svc) => {
    const gross =
      (Number(svc.pricePerSession) || 0) * (Number(svc.numberOfSessions) || 0);
    return s + Math.max(0, gross - (Number(svc.finalAmount) || 0));
  }, 0);

  // Only one-time billing settles money in this dialog; the other types collect later.
  const payWithClover =
    addForm.billingType === "one_time" &&
    addForm.billing.method === "card" &&
    enrTotalAmount > 0 &&
    cloverReady;
  const cloverNotConnected =
    addForm.billingType === "one_time" &&
    addForm.billing.method === "card" &&
    enrTotalAmount > 0 &&
    !cloverReady;

  // Flexible billing collects its initial payment through a second request, after the
  // package is created. When that payment is by card it returns its own checkoutUrl,
  // so this flow needs a pre-opened tab too — otherwise the link is silently dropped.
  const flexInitialByCard =
    addForm.billingType === "flexible" &&
    Number(addForm.billing.initialPayment || 0) > 0 &&
    (addForm.billing.initialPaymentMethod || "cash") === "card" &&
    cloverReady;

  function getEnrInstallments() {
    const {
      installmentMode,
      numberOfInstallments,
      installmentAmount,
      frequency,
      startDate,
    } = addForm.billing;
    if (!startDate) return [];
    let n, baseAmt;
    if (installmentMode === "amount") {
      const amt = Number(installmentAmount || 0);
      if (!amt || amt <= 0) return [];
      n = Math.ceil(enrTotalAmount / amt);
      if (!n) return [];
      baseAmt = amt;
    } else {
      n = Number(numberOfInstallments);
      if (!n || n < 1) return [];
      baseAmt = parseFloat((enrTotalAmount / n).toFixed(2));
    }
    const result = [];
    let d = new Date(startDate);
    for (let i = 0; i < n; i++) {
      const isLast = i === n - 1;
      const amount = isLast
        ? Math.max(
            0,
            parseFloat((enrTotalAmount - baseAmt * (n - 1)).toFixed(2)),
          )
        : baseAmt;
      result.push({
        date: d.toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        amount,
      });
      if (frequency === "weekly") d = new Date(d.getTime() + 7 * 86400000);
      else if (frequency === "biweekly")
        d = new Date(d.getTime() + 14 * 86400000);
      else {
        d = new Date(d);
        d.setMonth(d.getMonth() + 1);
      }
    }
    return result;
  }

  async function handleEnrAdd() {
    if (addForm.billingType === "payment_plan") {
      const {
        installmentMode,
        numberOfInstallments,
        installmentAmount,
        frequency,
        startDate,
      } = addForm.billing;
      if (!frequency || !startDate) {
        toast.error("Please fill all payment plan fields.");
        return;
      }
      if (installmentMode === "amount" && !Number(installmentAmount)) {
        toast.error("Please enter an installment amount.");
        return;
      }
      if (installmentMode !== "amount" && !numberOfInstallments) {
        toast.error("Please enter number of installments.");
        return;
      }
    }
    const checkoutTab =
      payWithClover || flexInitialByCard ? openCheckoutTab() : null;
    setAdding(true);
    const targetEnrollmentID = addTargetEnrollment?._id
      ? String(addTargetEnrollment._id)
      : "";

    const payload = {
      customerID,
      packageID: addForm.packageID,
      enrollmentID: targetEnrollmentID,
      services: addForm.services.map((s) => ({
        serviceCode: s.serviceCode,
        serviceName: s.serviceName,
        color: s.color,
        numberOfSessions: Number(s.numberOfSessions),
        pricePerSession: Number(s.pricePerSession),
        discountType: s.discountType || "none",
        discountAmount: Number(s.discountAmount || 0),
        finalAmount: Number(s.finalAmount),
      })),
      billingType: addForm.billingType,
      billing:
        addForm.billingType === "one_time"
          ? { method: addForm.billing.method }
          : addForm.billingType === "payment_plan"
            ? {
                installmentMode: addForm.billing.installmentMode || "count",
                numberOfInstallments:
                  addForm.billing.installmentMode === "amount"
                    ? Math.ceil(
                        enrTotalAmount /
                          Number(addForm.billing.installmentAmount || 1),
                      )
                    : Number(addForm.billing.numberOfInstallments),
                installmentAmount:
                  addForm.billing.installmentMode === "amount"
                    ? Number(addForm.billing.installmentAmount)
                    : undefined,
                frequency: addForm.billing.frequency,
                startDate: addForm.billing.startDate,
              }
            : addForm.billingType === "flexible"
              ? { dueDate: addForm.billing.dueDate || undefined }
              : {},
    };
    if (addForm.purchaseDate) payload.purchaseDate = addForm.purchaseDate;
    const res = await api.post("/api/customer-package/add", payload);
    if (!res.success) {
      closeCheckoutTab(checkoutTab);
      toast.error(res.error || "Failed to add package.");
      setAdding(false);
      return;
    }
    if (res.data?.checkoutUrl) {
      navigateCheckoutTab(checkoutTab, res.data.checkoutUrl);
      toast.success(CHECKOUT_TOAST);
      setAddTargetEnrollment(null);
      load();
      setAdding(false);
      return;
    }
    // A flexible package still owes its initial payment below, and that request may
    // return the checkout link. Only a flow with nothing left to collect can close
    // the tab here.
    if (!flexInitialByCard) closeCheckoutTab(checkoutTab);

    const initialPayment = Number(addForm.billing.initialPayment || 0);
    if (addForm.billingType === "flexible" && initialPayment > 0) {
      const payRes = await api.post("/api/payment", {
        customerID,
        enrollmentID: targetEnrollmentID,
        type: "package_purchase",
        amount: initialPayment,
        method: addForm.billing.initialPaymentMethod || "cash",
      });
      if (!payRes.success) {
        closeCheckoutTab(checkoutTab);
        toast.error(
          payRes.error || "Package added, but initial payment failed.",
        );
        setAddTargetEnrollment(null);
        load();
        setAdding(false);
        return;
      }
      if (payRes.data?.checkoutUrl) {
        navigateCheckoutTab(checkoutTab, payRes.data.checkoutUrl);
        toast.success(CHECKOUT_TOAST);
        setAddTargetEnrollment(null);
        load();
        setAdding(false);
        return;
      }
      closeCheckoutTab(checkoutTab);
    }

    toast.success("Package added.");
    setAddTargetEnrollment(null);
    load();
    setAdding(false);
  }

  async function handleEnrCancel(refundOption, refundAmount) {
    if (!cancelTarget) return;
    setCancelling(true);
    const res = await api.patch(
      `/api/customer-package/${cancelTarget.enrollmentId}/cancel`,
      { refundOption, refundAmount },
    );
    if (res.success) {
      toast.success("Package cancelled.");
      setCancelTarget(null);
      load();
    } else toast.error(res.error || "Failed.");
    setCancelling(false);
  }

  async function handleEnrExtend() {
    if (!extendTarget || !extendDate) return;
    setExtending(true);
    const res = await api.put(
      `/api/enrollment/${extendTarget._id}/extend-expiry`,
      { expiryDate: extendDate },
    );
    if (res.success) {
      toast.success("Expiry date extended.");
      setExtendTarget(null);
      setExtendDate("");
      load();
    } else toast.error(res.error || "Failed to extend expiry.");
    setExtending(false);
  }

  if (loading)
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner />
      </div>
    );

  const enrInstallments = getEnrInstallments();

  const filteredEnrollments = statusFilter
    ? enrollments.filter((e) => {
        if (statusFilter === "active")
          return e.status === "active" && e.package?.status !== "cancelled";
        if (statusFilter === "cancelled")
          return e.package?.status === "cancelled";
        if (statusFilter === "expired") return e.package?.status === "expired";
        if (statusFilter === "completed") {
          const svcs = e.package?.services ?? [];
          const total = svcs.reduce(
            (s, svc) => s + (svc.sessionsTotal ?? 0),
            0,
          );
          const used = svcs.reduce(
            (s, svc) => s + Math.max(svc.sessionsCompleted ?? 0, svc.sessionsUsed ?? 0),
            0,
          );
          return (
            e.status !== "active" &&
            e.package?.status !== "expired" &&
            e.package?.status !== "cancelled" &&
            total > 0 &&
            used >= total
          );
        }
        return true;
      })
    : enrollments;

  const isActiveTab = statusFilter === "active";

  const selectedEnr =
    filteredEnrollments.find((e) => String(e._id) === selectedEnrId) ??
    filteredEnrollments[filteredEnrollments.length - 1] ??
    null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setSelectedEnrId(null);
              }}
              className="h-8 rounded-lg border border-border bg-background pl-3 pr-8 text-[12px] font-medium text-foreground outline-none focus:border-primary appearance-none cursor-pointer"
            >
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
          {filteredEnrollments.length > 0 ? (
            <div className="relative">
              <select
                value={selectedEnrId ?? ""}
                onChange={(e) => setSelectedEnrId(e.target.value)}
                className="h-8 rounded-lg border border-border bg-background pl-3 pr-8 text-[12px] font-medium text-foreground outline-none focus:border-primary appearance-none cursor-pointer"
              >
                {[...filteredEnrollments].reverse().map((enr) => {
                  const ordinal =
                    ["1st", "2nd", "3rd"][enr.enrollmentNumber - 1] ??
                    `${enr.enrollmentNumber}th`;
                  const pkgName = enrollmentDisplayName(enr);
                  return (
                    <option key={enr._id} value={String(enr._id)}>
                      {ordinal} Enrollment{pkgName ? ` — ${pkgName}` : ""}
                    </option>
                  );
                })}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">0 enrollments</p>
          )}
        </div>
        {isActiveTab && (
          <Button
            size="sm"
            className="h-8 text-[12px]"
            onClick={openCreateAndAddFlow}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Enroll
          </Button>
        )}
      </div>

      {filteredEnrollments.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center text-[13px] text-muted-foreground">
          {isActiveTab
            ? 'No active enrollments. Click "New Enrollment" to create one.'
            : `No ${statusFilter} enrollments.`}
        </div>
      ) : selectedEnr ? (
        <div className="space-y-4">
          {[selectedEnr].map((enr) => {
            const det = enr.package ? detailsMap[String(enr._id)] : null;
            const cp = enr.package ?? null;
            const billing = det?.billing ?? {};
            const services = det?.services ?? cp?.services ?? [];
            const totalPaid = billing.totalPaid ?? cp?.totalPaid ?? 0;
            const collected =
              billing.amountCollected ?? cp?.amountCollected ?? 0;
            const outstanding =
              billing.outstanding ?? Math.max(0, totalPaid - collected);
            const refunded = billing.totalRefunded ?? 0;
            const ordinal =
              ["1st", "2nd", "3rd"][enr.enrollmentNumber - 1] ??
              `${enr.enrollmentNumber}th`;

            return (
              <div
                key={enr._id}
                className="rounded-xl border border-border bg-card overflow-hidden"
              >
                {/* Enrollment header bar */}
                <div className="flex items-center justify-between px-5 py-4 bg-muted/40 border-b border-border">
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-bold text-foreground uppercase tracking-wider">
                      {ordinal} Enrollment
                    </span>
                    {enr.label && (
                      <span className="text-[12px] font-medium text-muted-foreground">
                        · {enr.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {enr.teacherID?.name && (
                      <span className="text-[12px] font-medium text-foreground">
                        {enr.teacherID.name}
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusColor(enr.status)}`}
                    >
                      {enr.status}
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      {formatDate(enr.createdAt)}
                    </span>
                  </div>
                </div>

                {/* No package yet */}
                {!cp ? (
                  <div className="flex items-center justify-between px-5 py-8">
                    <p className="text-[13px] text-muted-foreground">
                      No package assigned yet.
                    </p>
                    {enr.status === "active" && (
                      <Button
                        size="sm"
                        className="h-8 text-[12px]"
                        onClick={() => openAddPackage(enr)}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Package
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="p-5">
                    {/* Package header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {cp.packageRef?.color && (
                          <div
                            className="h-9 w-9 rounded-lg shrink-0 border border-black/10"
                            style={{ backgroundColor: cp.packageRef.color }}
                          />
                        )}
                        <div>
                          <p className="text-[15px] font-bold text-foreground">
                            {enrollmentDisplayName(enr) || "Package"}
                          </p>
                          <p className="text-[12px] text-muted-foreground mt-1">
                            Purchased {formatDate(cp.purchaseDate)}
                            {cp.expiryDate
                              ? ` · Expires ${formatDate(cp.expiryDate)}`
                              : " · No expiry"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
                        {cp.billingType && cp.billingType !== "one_time" && (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-violet-500/10 text-violet-600 capitalize">
                            {cp.billingType.replace("_", " ")}
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${paymentStatusColor(cp.paymentStatus)}`}
                        >
                          {paymentStatusLabel(cp.paymentStatus)}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusColor(cp.status)}`}
                        >
                          {cp.status}
                        </span>
                        {cp.status !== "cancelled" && cp.expiryDate && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-[11px] font-medium"
                            onClick={() => {
                              setExtendDate(
                                new Date(cp.expiryDate)
                                  .toISOString()
                                  .slice(0, 10),
                              );
                              setExtendTarget({
                                _id: enr._id,
                                packageName: cp.packageName,
                              });
                            }}
                          >
                            Extend
                          </Button>
                        )}
                        {cp.status === "active" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-[11px] font-medium border-destructive/40 text-destructive hover:bg-destructive/10"
                            onClick={() =>
                              setCancelTarget({
                                enrollmentId: enr._id,
                                packageName: cp.packageName,
                                maxRefundable: Math.max(
                                  0,
                                  collected - refunded,
                                ),
                              })
                            }
                          >
                            <X className="h-3 w-3 mr-1" /> Cancel
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Billing summary */}
                    <div className="mt-4 grid grid-cols-4 divide-x divide-border rounded-lg border border-border bg-muted/30 overflow-hidden">
                      {[
                        {
                          label: "Total Price",
                          value: `$${Number(totalPaid).toFixed(2)}`,
                        },
                        {
                          label: "Collected",
                          value: `$${Number(collected).toFixed(2)}`,
                          cls: "text-success",
                        },
                        {
                          label: "Outstanding",
                          value: `$${Number(outstanding).toFixed(2)}`,
                          cls:
                            outstanding > 0
                              ? "text-rose-500"
                              : "text-muted-foreground",
                        },
                        {
                          label: "Refunded",
                          value: `$${Number(refunded).toFixed(2)}`,
                          cls:
                            refunded > 0
                              ? "text-warning"
                              : "text-muted-foreground",
                        },
                      ].map(({ label, value, cls }) => (
                        <div key={label} className="text-center py-3 px-2">
                          <p className="text-[11px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">
                            {label}
                          </p>
                          <p
                            className={`text-[15px] font-bold ${cls ?? "text-foreground"}`}
                          >
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Services */}
                    {services.length > 0 &&
                      (() => {
                        let totalEnrolled = 0,
                          totalUsed = 0,
                          totalSched = 0,
                          totalRemaining = 0,
                          totalCreditSessions = 0,
                          totalCredit = 0,
                          totalServicePrice = 0;
                        // Historically this proration only ran for
                        // "deferred" billing types (flexible/payment_plan/
                        // pay_per_session); "one_time" (including every
                        // migration-imported package, whose billingType
                        // defaults to "one_time" when the sheet leaves it
                        // blank) always showed 100% of remaining sessions as
                        // credit regardless of how much was actually
                        // collected — an unpaid balance displayed as
                        // spendable credit. The credit-vs-owed split must be
                        // based on the package's actual paid ratio
                        // (amountCollected / contractedValue) for every
                        // billing type, not gated on billingType at all.
                        const isDeferred =
                          cp.billingType === "flexible" ||
                          cp.billingType === "payment_plan" ||
                          cp.billingType === "pay_per_session";
                        // A service is "free" when it's marked non-chargeable or
                        // fully discounted (finalAmount 0). Free services only track
                        // sessions — no credit balance, no price.
                        const isFreeService = (sv) =>
                          sv.isChargeable === false ||
                          Number(sv.finalAmount || 0) <= 0;
                        // Net (post-discount) price for a service — what was
                        // actually charged, so proration below allocates the
                        // pooled `amountCollected` by what each service costs
                        // net of discount, not its undiscounted list price.
                        // Falls back to list price when finalAmount isn't set
                        // (legacy/migrated enrollments).
                        const svcNetPrice = (sv) => {
                          if (isFreeService(sv)) return 0;
                          const listPrice =
                            (sv.sessionsTotal ?? 0) *
                            Number(sv.pricePerSession || 0);
                          return Number(sv.finalAmount) > 0
                            ? Number(sv.finalAmount)
                            : listPrice;
                        };
                        // Sum of all chargeable services' net prices
                        // (denominator for proportion) — matches the
                        // per-service net price used for the numerator below,
                        // so proration and the sessions conversion (which
                        // uses discount-adjusted effectivePps) stay on the
                        // same discounted basis instead of mixing list-price
                        // weights with discounted per-session divisors.
                        const chargeableSvcPriceTotal = services.reduce(
                          (s, sv) => s + svcNetPrice(sv),
                          0,
                        );
                        const rows = services.map((svc, i) => {
                          const isFree = isFreeService(svc);
                          const sessTotal = svc.sessionsTotal ?? 0;
                          const sessSched = svc.sessionsScheduled ?? 0;
                          // See the same fix's comment above (list view) —
                          // `??` alone hides an imported Sessions Taken count
                          // whenever there's no real charge history, but
                          // sessionsUsed already counts still-scheduled
                          // sessions too, so subtract sessSched before taking
                          // the floor — otherwise a normal (non-imported)
                          // package double-counts its live-scheduled sessions
                          // as both "completed" and "scheduled".
                          const sessUsed = Math.max(
                            svc.sessionsCompleted ?? 0,
                            (svc.sessionsUsed ?? 0) - sessSched,
                          );
                          const sessRemaining = Math.max(
                            0,
                            sessTotal - sessUsed - sessSched,
                          );
                          const pps = isFree
                            ? 0
                            : Number(svc.pricePerSession) || 0;
                          const effectivePps = isFree
                            ? 0
                            : sessTotal > 0 && svc.finalAmount > 0
                              ? Number(svc.finalAmount) / sessTotal
                              : pps;
                          const svcTotal = isFree ? 0 : sessTotal * pps;
                          // For deferred billing, credit = paid amount ÷ price-per-session (decimal)
                          const svcCreditSessions = (() => {
                            if (isFree) return 0;
                            if (pps <= 0) return sessRemaining;
                            // Fully collected (paid ratio >= 100%, e.g. the
                            // common "one_time" fully-paid case) — every
                            // remaining session is credit, no proration
                            // needed. Only an *actual* unpaid/partial
                            // balance (any billing type) prorates below.
                            const totalContracted = Number(cp.totalPaid ?? cp.contractedValue ?? 0);
                            if (totalContracted > 0 && Number(cp.amountCollected ?? 0) >= totalContracted) {
                              return sessRemaining;
                            }
                            if (!isDeferred && totalContracted <= 0) return sessRemaining;
                            // Proportion by this service's share of total
                            // chargeable price, net of discount (same basis as
                            // chargeableSvcPriceTotal above).
                            const svcShare =
                              chargeableSvcPriceTotal > 0
                                ? svcNetPrice(svc) / chargeableSvcPriceTotal
                                : 1;
                            const svcAmountPaid =
                              (cp.amountCollected ?? 0) * svcShare;
                            const paidSessions = svcAmountPaid / effectivePps;
                            // Subtract scheduled sessions so credit reduces when booked
                            return Math.max(
                              0,
                              paidSessions - sessUsed - sessSched,
                            );
                          })();
                          // Valued at effectivePps (net of discount) rather
                          // than list-price pps, so a discounted package's
                          // dollar credit balance reflects what was actually
                          // charged per session, not the pre-discount rate.
                          const svcCredit = svcCreditSessions * effectivePps;
                          totalEnrolled += sessTotal;
                          totalUsed += sessUsed;
                          totalSched += sessSched;
                          // Matches the per-row Remaining cell (always
                          // sessRemaining, regardless of billing type) —
                          // Credit Balance is tracked separately below since
                          // the two columns mean different things for
                          // deferred/flexible billing.
                          totalRemaining += sessRemaining;
                          totalCreditSessions += svcCreditSessions;
                          totalCredit += svcCredit;
                          totalServicePrice += svcTotal;
                          return {
                            svc,
                            i,
                            isFree,
                            sessTotal,
                            sessUsed,
                            sessSched,
                            sessRemaining,
                            svcCreditSessions,
                            svcCredit,
                            svcTotal,
                            effectivePps,
                          };
                        });
                        return (
                          <div className="mt-5 border-t border-border pt-5">
                            <p className="text-[12px] font-bold text-foreground uppercase tracking-widest mb-3">
                              Services
                            </p>
                            <div className="rounded-lg border border-border overflow-hidden">
                              {/* Column headers */}
                              <div
                                className="grid sticky top-0 z-10 bg-muted/50 border-b-2 border-border px-3 py-2.5"
                                style={{
                                  gridTemplateColumns:
                                    "minmax(0,1fr) 80px 80px 80px 80px 80px",
                                }}
                              >
                                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                  Service
                                </span>
                                {[
                                  "Enrolled",
                                  "Completed",
                                  "Scheduled",
                                  "Remaining",
                                  "Credit Balance",
                                ].map((h) => (
                                  <span
                                    key={h}
                                    className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right"
                                  >
                                    {h}
                                  </span>
                                ))}
                              </div>
                              {/* Service rows */}
                              {rows.map(
                                ({
                                  svc,
                                  i,
                                  isFree,
                                  sessTotal,
                                  sessUsed,
                                  sessSched,
                                  sessRemaining,
                                  svcCreditSessions,
                                  svcCredit,
                                  svcTotal,
                                  effectivePps,
                                }) => {
                                  const expandKey = `${enr._id}-${i}`;
                                  const isExpanded =
                                    expandedServices.has(expandKey);
                                  return (
                                    <div
                                      key={i}
                                      className={
                                        i > 0 ? "border-t border-border" : ""
                                      }
                                    >
                                      <div
                                        className="grid items-center px-3 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
                                        style={{
                                          gridTemplateColumns:
                                            "minmax(0,1fr) 80px 80px 80px 80px 80px",
                                        }}
                                        onClick={() => toggleService(expandKey)}
                                      >
                                        <div>
                                          <div className="flex items-center gap-2">
                                            <ChevronDown
                                              className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                            />
                                            {svc.color && (
                                              <span
                                                className="h-2.5 w-2.5 rounded-full shrink-0 border border-black/10"
                                                style={{
                                                  backgroundColor: svc.color,
                                                }}
                                              />
                                            )}
                                            <span className="text-[12px] font-medium text-foreground">
                                              {svc.serviceName}
                                            </span>
                                            {isFree && (
                                              <span className="shrink-0 inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                                                {svc.isChargeable === false
                                                  ? "Non-chargeable"
                                                  : "Free"}
                                              </span>
                                            )}
                                          </div>
                                          <div className="mt-1.5 pl-[28px]">
                                            <SessionBar
                                              used={sessUsed + sessSched}
                                              total={sessTotal}
                                            />
                                          </div>
                                        </div>
                                        <span className="text-[13px] font-semibold text-foreground text-right">
                                          {sessTotal}
                                        </span>
                                        <span
                                          className={`text-[13px] font-semibold text-right ${sessUsed > 0 ? "text-info" : "text-muted-foreground"}`}
                                        >
                                          {sessUsed}
                                        </span>
                                        <span
                                          className={`text-[13px] font-semibold text-right ${sessSched > 0 ? "text-violet-600" : "text-muted-foreground"}`}
                                        >
                                          {sessSched}
                                        </span>
                                        <span
                                          className={`text-[13px] font-semibold text-right ${sessRemaining > 0 ? "text-foreground" : "text-muted-foreground"}`}
                                        >
                                          {sessRemaining}
                                        </span>
                                        {/* Credit Balance is a SESSION COUNT —
                                            how many sessions the customer has
                                            effectively paid for and can still
                                            schedule (svcCreditSessions), not a
                                            dollar figure (svcCredit is the $
                                            equivalent, shown on hover/expanded
                                            detail elsewhere, not here). The
                                            actual bug was that this only got
                                            rounded when billing was
                                            "deferred" — a partially-paid
                                            one_time package rendered the raw
                                            float unrounded (e.g.
                                            "2.9803921568"). Round unconditionally instead. */}
                                        <span
                                          className={`text-[13px] font-semibold text-right ${svcCreditSessions > 0 ? "text-success" : "text-muted-foreground"}`}
                                          title={`$${svcCredit.toFixed(2)}`}
                                        >
                                          {isFree
                                            ? "—"
                                            : svcCreditSessions
                                                .toFixed(2)
                                                .replace(/\.00$/, "")
                                                .replace(/(\.\d)0$/, "$1")}
                                        </span>
                                      </div>
                                      {isExpanded && (
                                        <div className="border-t border-border/50 bg-muted/10 px-4 py-4 pl-10">
                                          {(() => {
                                            const svcEvents = calendarEvents
                                              .filter((e) => {
                                                const cs = e.calendarServiceID;
                                                if (!cs) return false;
                                                const matchesService =
                                                  svc.serviceCode
                                                    ? cs.serviceCode ===
                                                      svc.serviceCode
                                                    : cs.serviceName ===
                                                      svc.serviceName;
                                                if (!matchesService)
                                                  return false;
                                                const charge = (
                                                  e.charges || []
                                                ).find(
                                                  (c) =>
                                                    String(c.customerID) ===
                                                      String(customerID) &&
                                                    c.method === "package",
                                                );
                                                if (!charge) return false;
                                                const chargedEnrId =
                                                  charge.enrollmentID?._id ??
                                                  charge.enrollmentID;
                                                return (
                                                  String(chargedEnrId) ===
                                                  String(enr._id)
                                                );
                                              })
                                              .sort(
                                                (a, b) =>
                                                  new Date(b.startDateTime) -
                                                  new Date(a.startDateTime),
                                              );
                                            if (svcEvents.length === 0)
                                              return (
                                                <p className="text-[12px] text-muted-foreground px-1 py-2">
                                                  No lessons scheduled yet for
                                                  this service.
                                                </p>
                                              );
                                            return (
                                              <div className="rounded-lg border border-border overflow-hidden">
                                                <div className="grid grid-cols-[1fr_140px_150px] gap-2 bg-muted/50 border-b border-border px-3 py-2">
                                                  {[
                                                    "Date & Time",
                                                    "Teacher",
                                                    "Status",
                                                  ].map((h) => (
                                                    <span
                                                      key={h}
                                                      className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                                                    >
                                                      {h}
                                                    </span>
                                                  ))}
                                                </div>
                                                {svcEvents.map((ev, idx) => (
                                                  <div
                                                    key={ev._id}
                                                    className={`grid grid-cols-[1fr_140px_150px] gap-2 items-center px-3 py-2 ${idx > 0 ? "border-t border-border/50" : ""}`}
                                                  >
                                                    <span className="text-[12px] text-foreground">
                                                      {new Date(
                                                        ev.startDateTime,
                                                      ).toLocaleDateString(
                                                        "en-US",
                                                        {
                                                          weekday: "short",
                                                          month: "short",
                                                          day: "numeric",
                                                          year: "numeric",
                                                        },
                                                      )}{" "}
                                                      ·{" "}
                                                      {new Date(
                                                        ev.startDateTime,
                                                      ).toLocaleTimeString(
                                                        "en-US",
                                                        {
                                                          hour: "numeric",
                                                          minute: "2-digit",
                                                          hour12: true,
                                                        },
                                                      )}
                                                    </span>
                                                    <span className="text-[12px] text-muted-foreground truncate">
                                                      {ev.teacherID?.name ||
                                                        "—"}
                                                    </span>
                                                    <span
                                                      className={`inline-flex w-fit max-w-full items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase leading-tight whitespace-normal text-center ${
                                                        ev.status ===
                                                        "completed"
                                                          ? "bg-info/10 text-info"
                                                          : ev.status?.startsWith(
                                                                "cancelled",
                                                              )
                                                            ? "bg-destructive/10 text-destructive"
                                                            : ev.status ===
                                                                "no_show"
                                                              ? "bg-warning/10 text-warning"
                                                              : "bg-violet-500/10 text-violet-500"
                                                      }`}
                                                    >
                                                      {(
                                                        ev.status || "scheduled"
                                                      ).replace(/_/g, " ")}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      )}
                                    </div>
                                  );
                                },
                              )}
                              {/* Totals row — sums across all services in
                                  this enrollment. Session-count columns
                                  (Enrolled/Completed/Scheduled/Remaining) sum
                                  across different service types (privates +
                                  groups + parties + coaching, etc.), so
                                  they're a rough "sessions total" rather than
                                  a like-for-like count — Credit Balance is
                                  the meaningful one since $ is a common unit
                                  across services. */}
                              {rows.length > 1 && (
                                <div
                                  className="grid items-center px-3 py-2.5 border-t-2 border-border bg-muted/30"
                                  style={{
                                    gridTemplateColumns:
                                      "minmax(0,1fr) 80px 80px 80px 80px 80px",
                                  }}
                                >
                                  <span className="text-[12px] font-bold text-foreground uppercase tracking-wide">
                                    Total
                                  </span>
                                  <span className="text-[13px] font-bold text-foreground text-right">
                                    {totalEnrolled}
                                  </span>
                                  <span className="text-[13px] font-bold text-foreground text-right">
                                    {totalUsed}
                                  </span>
                                  <span className="text-[13px] font-bold text-foreground text-right">
                                    {totalSched}
                                  </span>
                                  <span className="text-[13px] font-bold text-foreground text-right">
                                    {totalRemaining}
                                  </span>
                                  <span
                                    className={`text-[13px] font-bold text-right ${totalCreditSessions > 0 ? "text-success" : "text-muted-foreground"}`}
                                    title={`$${totalCredit.toFixed(2)}`}
                                  >
                                    {totalCreditSessions
                                      .toFixed(2)
                                      .replace(/\.00$/, "")
                                      .replace(/(\.\d)0$/, "$1")}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                    {/* Set up a going-forward payment plan on a package that
                        doesn't have one yet — mainly for migrated enrollments,
                        which land with a static outstanding balance and no
                        billing schedule (see customerImport.service.js).
                        setupPaymentPlanForEnrollment schedules cp.dueAmount,
                        not the Collected-derived `outstanding` figure above —
                        those two can diverge (e.g. this card's `outstanding`
                        is still $1000 for a legacy-imported enrollment whose
                        $700-collected Payment record predates this feature,
                        while dueAmount already correctly says $300). Pass the
                        same amount the backend will actually schedule so the
                        dialog never promises a number it won't deliver. */}
                    {(() => {
                      const schedulable =
                        cp.dueAmount != null
                          ? Number(cp.dueAmount)
                          : outstanding;
                      return (
                        (!cp.billingType || cp.billingType === "one_time") &&
                        enr.status === "active" &&
                        cp.status === "active" &&
                        !plansMap[String(enr._id)] &&
                        schedulable > 0 && (
                          <div className="mt-5 border-t border-border pt-5 flex items-center justify-between">
                            <p className="text-[12px] text-muted-foreground">
                              ${schedulable.toFixed(2)} outstanding with no
                              billing schedule.
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-[12px]"
                              onClick={() =>
                                setSetupPlanTarget({
                                  enrollment: enr,
                                  outstanding: schedulable,
                                })
                              }
                            >
                              + Set Up Payment Plan
                            </Button>
                          </div>
                        )
                      );
                    })()}

                    {/* Flexible billing — single-due-date payment card.
                        Hidden when the flexible enrollment carries a tracked
                        schedule (rendered as installments below instead). */}
                    {cp.billingType === "flexible" &&
                      enr.status === "active" &&
                      cp.paymentStatus !== "paid" &&
                      !plansMap[String(enr._id)] && (
                        <div className="mt-5 border-t border-border pt-5">
                          <p className="text-[12px] font-bold text-foreground uppercase tracking-widest mb-3">
                            Payment Due
                          </p>
                          <FlexiblePaymentDueCard
                            enr={enr}
                            customerID={customerID}
                            locationID={locationID}
                            onSuccess={load}
                          />
                        </div>
                      )}

                    {/* Payment plan / scheduled-flexible installments */}
                    {plansMap[String(enr._id)] && (
                      <PaymentSchedule
                        plan={plansMap[String(enr._id)]}
                        cpStatus={cp.status}
                        billingType={cp.billingType}
                        customerID={customerID}
                        locationID={locationID}
                        onPayInstallment={setPayInstallTarget}
                        onChangeDate={setChangeInstallDateTarget}
                        onAddInstallment={setAddInstallTarget}
                        onSent={load}
                      />
                    )}

                    <PaymentTimeline
                      customerID={customerID}
                      enrollmentID={String(enr._id)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Pay installment dialog */}
      <PayInstallmentDialog
        open={Boolean(payInstallTarget)}
        onClose={() => setPayInstallTarget(null)}
        plan={payInstallTarget?.plan}
        installmentIndex={payInstallTarget?.index}
        billingType={payInstallTarget?.billingType}
        locationID={locationID}
        onSuccess={load}
      />

      {/* Change installment date dialog */}
      <ChangeInstallmentDateDialog
        open={Boolean(changeInstallDateTarget)}
        onClose={() => setChangeInstallDateTarget(null)}
        plan={changeInstallDateTarget?.plan}
        installmentIndex={changeInstallDateTarget?.index}
        onSuccess={load}
      />

      {/* Cancel confirm */}
      <CancelRefundDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title="Cancel Package"
        itemName={cancelTarget?.packageName}
        maxRefundable={cancelTarget?.maxRefundable ?? 0}
        submitting={cancelling}
        onConfirm={handleEnrCancel}
      />

      {/* Add installment dialog — flexible plans only */}
      <AddInstallmentDialog
        open={Boolean(addInstallTarget)}
        onClose={() => setAddInstallTarget(null)}
        plan={addInstallTarget}
        onSuccess={load}
      />

      {/* Set up a new payment plan on an existing package (e.g. migrated enrollments) */}
      <SetupPaymentPlanDialog
        open={Boolean(setupPlanTarget)}
        onClose={() => setSetupPlanTarget(null)}
        enrollment={setupPlanTarget?.enrollment}
        outstanding={setupPlanTarget?.outstanding ?? 0}
        onSuccess={load}
      />

      {/* Extend expiry */}
      <Dialog
        open={Boolean(extendTarget)}
        onOpenChange={(v) => {
          if (!v) {
            setExtendTarget(null);
            setExtendDate("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Extend Package Expiry</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground mt-1">
            Set a new expiry date for{" "}
            <span className="font-semibold text-foreground">
              {extendTarget?.packageName}
            </span>
            . If the new date is in the future the package will be reactivated.
          </p>
          <div className="mt-4">
            <label className="text-[12px] font-medium text-foreground block mb-1">
              New Expiry Date
            </label>
            <input
              type="date"
              value={extendDate}
              onChange={(e) => setExtendDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setExtendTarget(null);
                setExtendDate("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={extending || !extendDate}
              onClick={handleEnrExtend}
            >
              {extending ? "Saving…" : "Extend Expiry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CreateEnrollmentSheet
        open={createEnrollmentOpen}
        onClose={() => setCreateEnrollmentOpen(false)}
        customerID={customerID}
        customerName={customerName}
        locationID={locationID}
        onSuccess={() => {
          toast.success("Enrollment and package created.");
          load();
        }}
      />

      {/* Add Package — side panel */}
      <Sheet
        open={Boolean(addTargetEnrollment)}
        onClose={() => setAddTargetEnrollment(null)}
        width="520px"
      >
        <SheetContent
          onClose={() => setAddTargetEnrollment(null)}
          className="flex flex-col overflow-hidden p-0"
        >
          <div className="shrink-0 border-b border-border px-5 py-4">
            <h2 className="text-[15px] font-bold text-foreground">
              Add Package
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="space-y-4">
              {/* ── Package ── */}
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Package" required>
                  <div className="relative">
                    <select
                      value={addForm.packageID}
                      onChange={(e) => onEnrPkgChange(e.target.value)}
                      className="h-8 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[12px] outline-none focus:border-primary"
                    >
                      <option value="">Select package…</option>
                      {allPkgs.map((p) => (
                        <option key={p._id} value={p._id}>
                          {p.packageName}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </FormField>
                <FormField label="Purchase date (optional)">
                  <input
                    type="date"
                    value={addForm.purchaseDate}
                    onChange={(e) =>
                      setAddForm((f) => ({
                        ...f,
                        purchaseDate: e.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-lg border border-border bg-background px-3 text-[12px] outline-none focus:border-primary"
                  />
                </FormField>
              </div>

              {/* ── Services table ── */}
              {(addForm.packageID || addForm.services.length > 0) && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                    Services
                  </p>
                  <div className="rounded-lg border border-border overflow-x-auto">
                    <table className="min-w-full text-[12px]">
                      <thead>
                        <tr className="bg-muted/40 border-b border-border">
                          {[
                            "Service",
                            "Color",
                            "Sessions",
                            "Price / Session",
                            "Discount",
                            "Total",
                            "",
                          ].map((h, i) => (
                            <th
                              key={i}
                              className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {addForm.services.map((svc, i) => (
                          <tr
                            key={i}
                            className={i > 0 ? "border-t border-border" : ""}
                          >
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={svc.serviceName}
                                onChange={(e) =>
                                  updateEnrSvc(i, "serviceName", e.target.value)
                                }
                                placeholder="Service name"
                                className="h-7 w-36 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:border-primary"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="color"
                                value={svc.color || "#6366f1"}
                                onChange={(e) =>
                                  updateEnrSvc(i, "color", e.target.value)
                                }
                                className="h-7 w-8 rounded border border-border cursor-pointer p-0.5 bg-background"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                value={svc.numberOfSessions}
                                onChange={(e) =>
                                  updateEnrSvc(
                                    i,
                                    "numberOfSessions",
                                    e.target.value,
                                  )
                                }
                                className="h-7 w-16 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:border-primary"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                                  $
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={svc.pricePerSession}
                                  onChange={(e) =>
                                    updateEnrSvc(
                                      i,
                                      "pricePerSession",
                                      e.target.value,
                                    )
                                  }
                                  className="h-7 w-20 rounded-md border border-border bg-background pl-5 pr-2 text-[11px] outline-none focus:border-primary"
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1">
                                <select
                                  value={svc.discountType}
                                  onChange={(e) =>
                                    updateEnrSvc(
                                      i,
                                      "discountType",
                                      e.target.value,
                                    )
                                  }
                                  className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px] outline-none focus:border-primary"
                                >
                                  <option value="none">—</option>
                                  <option value="percentage">%</option>
                                  <option value="fixed">$</option>
                                </select>
                                {svc.discountType !== "none" && (
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={svc.discountAmount}
                                    onChange={(e) =>
                                      updateEnrSvc(
                                        i,
                                        "discountAmount",
                                        e.target.value,
                                      )
                                    }
                                    className="h-7 w-16 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:border-primary"
                                  />
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-[12px] font-semibold text-foreground whitespace-nowrap">
                              ${Number(svc.finalAmount).toFixed(2)}
                            </td>
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                onClick={() => removeEnrSvcRow(i)}
                                className="text-muted-foreground hover:text-destructive text-[16px] leading-none"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        {enrTotalDiscount > 0 && (
                          <tr className="border-t border-border bg-muted/20">
                            <td
                              colSpan={5}
                              className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground text-right"
                            >
                              Discount
                            </td>
                            <td className="px-3 py-1.5 text-[11px] font-medium text-warning">
                              -${enrTotalDiscount.toFixed(2)}
                            </td>
                            <td />
                          </tr>
                        )}
                        <tr className="border-t border-border bg-muted/30">
                          <td
                            colSpan={5}
                            className="px-3 py-2 text-[11px] font-medium text-muted-foreground text-right"
                          >
                            Total
                          </td>
                          <td className="px-3 py-2 text-[12px] font-semibold text-foreground">
                            ${enrTotalAmount.toFixed(2)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <button
                    type="button"
                    onClick={addEnrSvcRow}
                    className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" /> Add service
                  </button>
                </div>
              )}

              {/* ── Billing ── */}
              {addForm.services.length > 0 &&
                (() => {
                  const chargeableSvcs = addForm.services.filter(
                    (s) => s.isChargeable !== false,
                  );
                  const canPayPerSession = chargeableSvcs.length === 1;
                  return (
                    <div className="space-y-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        Billing
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          {
                            value: "one_time",
                            label: "One-time",
                            desc: "Full payment now",
                          },
                          {
                            value: "payment_plan",
                            label: "Payment Plan",
                            desc: "Autopay installments",
                          },
                          {
                            value: "flexible",
                            label: "Flexible",
                            desc: "Pay as you go",
                          },
                          {
                            value: "pay_per_session",
                            label: "Pay Per Session",
                            desc: "Charge per booking",
                            disabled: !canPayPerSession,
                          },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            disabled={opt.disabled}
                            title={
                              opt.disabled && opt.value === "pay_per_session"
                                ? "Requires exactly 1 chargeable service"
                                : undefined
                            }
                            onClick={() =>
                              !opt.disabled &&
                              setAddForm((f) => ({
                                ...f,
                                billingType: opt.value,
                              }))
                            }
                            className={`rounded-lg border-2 p-2.5 text-left transition-colors ${
                              addForm.billingType === opt.value
                                ? "border-primary bg-primary/5"
                                : opt.disabled
                                  ? "border-border bg-muted/20 text-muted-foreground opacity-50 cursor-not-allowed"
                                  : "border-border hover:border-border/80 bg-background"
                            }`}
                          >
                            <p className="text-[12px] font-semibold text-foreground">
                              {opt.label}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {opt.desc}
                            </p>
                          </button>
                        ))}
                      </div>
                      {!canPayPerSession && addForm.services.length > 0 && (
                        <p className="text-[10px] text-muted-foreground">
                          Pay Per Session requires exactly 1 chargeable service.{" "}
                          {chargeableSvcs.length === 0
                            ? "No chargeable services."
                            : `This package has ${chargeableSvcs.length} chargeable services.`}
                        </p>
                      )}

                      {addForm.billingType === "one_time" && (
                        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[12px] text-muted-foreground">
                              Payable Balance
                            </p>
                            <p className="text-[16px] font-bold text-foreground">
                              ${enrTotalAmount.toFixed(2)}
                            </p>
                          </div>
                          <FormField label="Payment Method" required>
                            <div className="relative">
                              <select
                                value={addForm.billing.method}
                                onChange={(e) =>
                                  setEnrBilling("method", e.target.value)
                                }
                                className="h-8 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[12px] outline-none focus:border-primary capitalize"
                              >
                                {PAYMENT_METHODS.map((m) => (
                                  <option key={m.value} value={m.value}>
                                    {m.label}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            </div>
                          </FormField>
                          {cloverNotConnected && (
                            <p className="text-[12px] text-muted-foreground">
                              Connect a card processor (Clover or Stripe) in Settings → Integrations to charge a card.
                            </p>
                          )}
                        </div>
                      )}

                      {addForm.billingType === "payment_plan" && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <FormField label="Installment Mode" required>
                              <div className="relative">
                                <select
                                  value={
                                    addForm.billing.installmentMode ?? "count"
                                  }
                                  onChange={(e) =>
                                    setEnrBilling(
                                      "installmentMode",
                                      e.target.value,
                                    )
                                  }
                                  className="h-8 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[12px] outline-none focus:border-primary"
                                >
                                  <option value="count">
                                    No. of Installments
                                  </option>
                                  <option value="amount">
                                    Installment Amount
                                  </option>
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                              </div>
                            </FormField>
                            {addForm.billing.installmentMode === "amount" ? (
                              <FormField
                                label="Amount per Installment"
                                required
                              >
                                <div className="relative">
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                                    $
                                  </span>
                                  <input
                                    type="number"
                                    min="1"
                                    step="0.01"
                                    placeholder="e.g. 100"
                                    value={
                                      addForm.billing.installmentAmount ?? ""
                                    }
                                    onChange={(e) =>
                                      setEnrBilling(
                                        "installmentAmount",
                                        e.target.value,
                                      )
                                    }
                                    className="h-8 w-full rounded-lg border border-border bg-background pl-6 pr-3 text-[12px] outline-none focus:border-primary"
                                  />
                                </div>
                              </FormField>
                            ) : (
                              <FormField label="Installments" required>
                                <input
                                  type="number"
                                  min="2"
                                  max="52"
                                  value={addForm.billing.numberOfInstallments}
                                  onChange={(e) =>
                                    setEnrBilling(
                                      "numberOfInstallments",
                                      e.target.value,
                                    )
                                  }
                                  className="h-8 w-full rounded-lg border border-border bg-background px-3 text-[12px] outline-none focus:border-primary"
                                />
                              </FormField>
                            )}
                            <FormField label="Frequency" required>
                              <div className="relative">
                                <select
                                  value={addForm.billing.frequency}
                                  onChange={(e) =>
                                    setEnrBilling("frequency", e.target.value)
                                  }
                                  className="h-8 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[12px] outline-none focus:border-primary"
                                >
                                  <option value="weekly">Weekly</option>
                                  <option value="biweekly">Biweekly</option>
                                  <option value="monthly">Monthly</option>
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                              </div>
                            </FormField>
                            <FormField label="Start Date" required>
                              <input
                                type="date"
                                value={addForm.billing.startDate}
                                onChange={(e) =>
                                  setEnrBilling("startDate", e.target.value)
                                }
                                className="h-8 w-full rounded-lg border border-border bg-background px-3 text-[12px] outline-none focus:border-primary"
                              />
                            </FormField>
                          </div>
                          {enrInstallments.length > 0 && (
                            <div className="rounded-lg border border-border bg-muted/20 p-3">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                                  Schedule Preview
                                </p>
                                {enrTotalDiscount > 0 && (
                                  <span className="text-[11px] text-warning">
                                    ${enrTotalDiscount.toFixed(2)} discount
                                    spread across payments
                                  </span>
                                )}
                              </div>
                              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                                {enrInstallments.map((inst, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center justify-between py-1 border-b border-border/30 last:border-0"
                                  >
                                    <span className="text-[11px] text-muted-foreground">
                                      Payment {i + 1} · {inst.date}
                                    </span>
                                    <span className="text-[12px] font-medium text-foreground">
                                      ${inst.amount.toFixed(2)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                                <p className="text-[12px] font-medium text-muted-foreground">
                                  Payable Balance
                                </p>
                                <p className="text-[14px] font-bold text-foreground">
                                  ${enrTotalAmount.toFixed(2)}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {addForm.billingType === "flexible" && (
                        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                          <p className="text-[11px] text-muted-foreground">
                            No schedule set. Payment can be collected at any
                            time.
                          </p>
                          <div>
                            <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                              Due Date
                            </label>
                            <input
                              type="date"
                              value={addForm.billing.dueDate}
                              onChange={(e) =>
                                setEnrBilling("dueDate", e.target.value)
                              }
                              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] outline-none focus:border-primary"
                            />
                          </div>
                          <div className="space-y-2 pt-2 border-t border-border">
                            <p className="text-[10px] font-medium text-muted-foreground">
                              Initial Payment (optional)
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                                  $
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder="0.00"
                                  value={addForm.billing.initialPayment}
                                  onChange={(e) =>
                                    setEnrBilling(
                                      "initialPayment",
                                      e.target.value,
                                    )
                                  }
                                  className="w-full rounded-md border border-border bg-background pl-6 pr-2.5 py-1.5 text-[11px] outline-none focus:border-primary"
                                />
                              </div>
                              <select
                                value={addForm.billing.initialPaymentMethod}
                                onChange={(e) =>
                                  setEnrBilling(
                                    "initialPaymentMethod",
                                    e.target.value,
                                  )
                                }
                                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] capitalize outline-none focus:border-primary"
                              >
                                {PAYMENT_METHODS.map((m) => (
                                  <option key={m.value} value={m.value}>
                                    {m.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-2 border-t border-border">
                            <p className="text-[12px] text-muted-foreground">
                              Payable Balance
                            </p>
                            <p className="text-[14px] font-bold text-foreground">
                              ${enrTotalAmount.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      )}

                      {addForm.billingType === "pay_per_session" && (
                        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                          <p className="text-[11px] text-muted-foreground">
                            No upfront payment. A charge is recorded
                            automatically each time a session is booked.
                          </p>
                          {chargeableSvcs.map((s) => {
                            const sessions = Number(s.numberOfSessions || 0);
                            const pricePerSession = Number(
                              s.pricePerSession || 0,
                            );
                            const finalAmount = Number(s.finalAmount || 0);
                            const hasDiscount =
                              s.discountType !== "none" &&
                              Number(s.discountAmount || 0) > 0;
                            const charges =
                              Array(sessions).fill(pricePerSession);
                            if (hasDiscount) {
                              let remaining = Math.max(
                                0,
                                pricePerSession * sessions - finalAmount,
                              );
                              for (
                                let i = sessions - 1;
                                i >= 0 && remaining > 0;
                                i--
                              ) {
                                const reduction = Math.min(
                                  charges[i],
                                  remaining,
                                );
                                charges[i] =
                                  Math.round((charges[i] - reduction) * 100) /
                                  100;
                                remaining =
                                  Math.round((remaining - reduction) * 100) /
                                  100;
                              }
                            }
                            return (
                              <div
                                key={s.serviceCode}
                                className="pt-2 border-t border-border space-y-1.5"
                              >
                                <div className="flex items-center justify-between">
                                  <p className="text-[11px] font-semibold text-foreground">
                                    {s.serviceName || s.serviceCode}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {sessions} sessions · $
                                    {pricePerSession.toFixed(2)}/sess
                                  </p>
                                </div>
                                <div className="rounded-md border border-border overflow-hidden">
                                  <div className="grid grid-cols-2 bg-muted/40 px-2.5 py-1">
                                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                                      Session
                                    </span>
                                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">
                                      Charge
                                    </span>
                                  </div>
                                  <div className="max-h-40 overflow-y-auto">
                                    {charges.map((amount, idx) => {
                                      const isDiscounted =
                                        hasDiscount && amount < pricePerSession;
                                      return (
                                        <div
                                          key={idx}
                                          className={`grid grid-cols-2 px-2.5 py-1 ${idx > 0 ? "border-t border-border" : ""}`}
                                        >
                                          <span className="text-[11px] text-foreground">
                                            Session {idx + 1}
                                          </span>
                                          <div className="text-right">
                                            {isDiscounted && (
                                              <span className="text-[10px] text-muted-foreground line-through mr-1">
                                                ${pricePerSession.toFixed(2)}
                                              </span>
                                            )}
                                            <span
                                              className={`text-[11px] font-semibold ${isDiscounted ? "text-warning" : "text-foreground"}`}
                                            >
                                              ${amount.toFixed(2)}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          <div className="flex items-center justify-between pt-2 border-t border-border">
                            <p className="text-[11px] text-muted-foreground">
                              Total (if all sessions booked)
                            </p>
                            <p className="text-[13px] font-bold text-foreground">
                              $
                              {chargeableSvcs
                                .reduce(
                                  (sum, s) => sum + Number(s.finalAmount || 0),
                                  0,
                                )
                                .toFixed(2)}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

              {/* ── Footer ── */}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAddTargetEnrollment(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={adding || cloverNotConnected}
                  onClick={() => handleEnrAdd()}
                >
                  {adding
                    ? "Adding…"
                    : payWithClover
                      ? "Pay by card"
                      : "Add Package"}
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Payment History Tab ─────────────────────────────────────────────────────

function FlexiblePaymentDueCard({ enr, customerID, locationID, onSuccess }) {
  const cp = enr.package;
  const collected = cp.amountCollected ?? 0;
  const outstanding = Math.max(0, (cp.totalPaid ?? 0) - collected);
  const isOverdue =
    cp.dueDate && outstanding > 0 && new Date(cp.dueDate) < new Date();
  const [mode, setMode] = useState(null); // "pay" | "change-date"
  const [amount, setAmount] = useState(String(outstanding.toFixed(2)));
  const [method, setMethod] = useState("cash");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [shortfallMethod, setShortfallMethod] = useState("cash");
  const [walletBalance, setWalletBalance] = useState(0);
  const [deviceID, setDeviceID] = useState("");
  const [tipConfig, setTipConfig] = useState({ promptTip: false });
  const [newDueDate, setNewDueDate] = useState(
    cp.dueDate ? new Date(cp.dueDate).toISOString().slice(0, 10) : "",
  );
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const { ready: cloverReady } = useCardProcessor(locationID);

  useEffect(() => {
    if (mode === "pay") fetchWalletBalance(customerID).then(setWalletBalance);
  }, [mode, customerID]);

  // A wallet short of the amount is topped up by the shortfall method, and that is what
  // reaches Clover — so it decides whether a checkout tab is opened.
  const paymentFields = walletPaymentFields({
    method,
    shortfallMethod,
    balance: walletBalance,
    amountDue: parseFloat(amount) || 0,
  });
  const payWithClover = paymentFields.method === "card" && cloverReady;
  const cloverNotConnected = paymentFields.method === "card" && !cloverReady;
  const payWithTerminal = paymentFields.method === "terminal";
  const terminalNotSelected = payWithTerminal && !deviceID;
  const amountValid = parseFloat(amount) > 0;

  async function submitPayment() {
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) return;
    if (payWithTerminal && !deviceID) return;
    const checkoutTab = payWithClover ? openCheckoutTab() : null;
    setSaving(true);
    const res = await api.post("/api/payment", {
      customerID,
      enrollmentID: enr._id,
      type: "package_purchase",
      amount: num,
      ...walletPaymentFields({
        method,
        shortfallMethod,
        balance: walletBalance,
        amountDue: num,
      }),
      ...(payWithTerminal ? { deviceID, ...tipConfig } : {}),
      ...(paymentDate ? { paymentDate } : {}),
    });
    if (res.success) {
      if (res.data?.checkoutUrl) {
        navigateCheckoutTab(checkoutTab, res.data.checkoutUrl);
        toast.success(CHECKOUT_TOAST);
      } else {
        toast.success(
          num >= outstanding
            ? "Payment recorded."
            : "Partial payment recorded.",
        );
      }
      setMode(null);
      onSuccess();
    } else {
      closeCheckoutTab(checkoutTab);
      toast.error(res.error || "Failed to record payment.");
    }
    setSaving(false);
  }

  async function handlePay(e) {
    e.preventDefault();
    await submitPayment();
  }

  async function handleChangeDate(e) {
    e.preventDefault();
    if (!newDueDate) return;
    setSaving(true);
    const res = await api.patch(
      `/api/customer-package/${enr._id}/flexible-due`,
      {
        dueDate: newDueDate,
      },
    );
    if (res.success) {
      toast.success("Due date updated.");
      setMode(null);
      onSuccess();
    } else {
      toast.error(res.error || "Failed to update due date.");
    }
    setSaving(false);
  }

  return (
    <div
      className={`rounded-xl border ${isOverdue ? "border-rose-300 bg-rose-50/40 dark:bg-rose-900/10" : "border-warning/20 bg-warning/10"} p-4 space-y-3`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-semibold text-foreground">
              {cp.packageName}
            </p>
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-violet-500/10 text-violet-600">
              Flexible Billing
            </span>
            {isOverdue && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-rose-500/10 text-rose-600">
                Overdue
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-[11px] text-muted-foreground">
                Amount Due{" "}
              </span>
              <span className="text-[13px] font-bold text-rose-600">
                ${outstanding.toFixed(2)}
              </span>
            </div>
            {cp.dueDate && (
              <div>
                <span className="text-[11px] text-muted-foreground">
                  Due Date{" "}
                </span>
                <span
                  className={`text-[12px] font-medium ${isOverdue ? "text-rose-600" : "text-foreground"}`}
                >
                  {new Date(cp.dueDate).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            )}
          </div>
        </div>
        {mode === null && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              className="h-7 px-3 text-[11px] bg-success hover:bg-success text-white"
              onClick={() => setMode("pay")}
            >
              Pay Now
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-3 text-[11px]"
              onClick={() => setMode("change-date")}
            >
              Change Due Date
            </Button>
          </div>
        )}
      </div>

      {mode === "pay" && (
        <form
          onSubmit={handlePay}
          className="flex items-end gap-2 flex-wrap pt-2 border-t border-border/50"
        >
          <div className="flex-1 min-w-[120px]">
            <label className="block text-[10px] font-medium text-muted-foreground mb-1">
              Amount
            </label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">
                $
              </span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-background pl-6 pr-2.5 text-[12px] outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="flex-1 min-w-[100px]">
            <label className="block text-[10px] font-medium text-muted-foreground mb-1">
              Method
            </label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-[12px] outline-none focus:border-primary capitalize"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[130px]">
            <label className="block text-[10px] font-medium text-muted-foreground mb-1">
              Payment Date
            </label>
            <input
              type="date"
              value={paymentDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-[12px] outline-none focus:border-primary"
            />
          </div>
          <div className="flex flex-col gap-1.5 w-full">
            <WalletShortfallField
              method={method}
              balance={walletBalance}
              amountDue={parseFloat(amount) || 0}
              shortfallMethod={shortfallMethod}
              onShortfallMethodChange={setShortfallMethod}
            />
            {cloverNotConnected && (
              <p className="text-[11px] text-muted-foreground">
                Connect a card processor (Clover or Stripe) in Settings → Integrations to charge a card.
              </p>
            )}
            <TerminalDeviceField
              method={method}
              locationID={locationID}
              deviceID={deviceID}
              onDeviceChange={setDeviceID}
              onTipConfig={setTipConfig}
            />
            <div className="flex gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-3 text-[11px]"
                onClick={() => setMode(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-8 px-3 text-[11px]"
                disabled={saving || !amountValid || cloverNotConnected || terminalNotSelected}
              >
                {saving
                  ? payWithTerminal
                    ? "Waiting for terminal…"
                    : "Saving…"
                  : payWithClover
                    ? "Pay by card"
                    : payWithTerminal
                      ? "Charge Terminal"
                      : "Confirm Payment"}
              </Button>
            </div>
          </div>
        </form>
      )}

      {mode === "change-date" && (
        <form
          onSubmit={handleChangeDate}
          className="flex items-end gap-2 flex-wrap pt-2 border-t border-border/50"
        >
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[10px] font-medium text-muted-foreground mb-1">
              New Due Date
            </label>
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-[12px] outline-none focus:border-primary"
            />
          </div>
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-3 text-[11px]"
              onClick={() => setMode(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 px-3 text-[11px]"
              disabled={saving || !newDueDate}
            >
              {saving ? "Saving…" : "Update Date"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function PurchasesTab({ customerID }) {
  const [rows, setRows] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const toast = useToast();

  const [plans, setPlans] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [pRes, payRes, planRes] = await Promise.all([
      api.get(`/api/purchase?customerID=${customerID}&limit=100`),
      api.get(`/api/payment/customer/${customerID}?limit=200`),
      api.get(`/api/payment-plan/customer/${customerID}`),
    ]);
    if (pRes.success) setRows(Array.isArray(pRes.data) ? pRes.data : []);
    if (payRes.success) setPayments(Array.isArray(payRes.data) ? payRes.data : []);
    if (planRes.success) setPlans(Array.isArray(planRes.data) ? planRes.data : []);
    setLoading(false);
  }, [customerID]);

  useEffect(() => { load(); }, [load]);

  const paymentsFor = (purchaseID) =>
    payments.filter((p) => String(p.purchaseID?._id ?? p.purchaseID) === String(purchaseID));
  const planFor = (purchaseID) =>
    plans.find((pl) => String(pl.purchaseID?._id ?? pl.purchaseID) === String(purchaseID));

  async function payInstallment(plan, idx) {
    setBusyId(`${plan._id}:${idx}`);
    const res = await api.post(`/api/payment-plan/${plan._id}/pay-installment`, {
      installmentIndex: idx,
      method: "cash",
    });
    setBusyId(null);
    if (res.success) {
      if (res.data?.checkoutUrl) window.open(res.data.checkoutUrl, "_blank", "noopener");
      toast.success("Installment recorded");
      load();
    } else toast.error(res.error || "Failed");
  }

  async function toggleLineCheck(row, li) {
    const next = li.checkStatus !== "checked";
    setBusyId(li._id);
    const res = await api.patch(`/api/purchase/${row._id}/line/${li._id}/check`, { checked: next });
    setBusyId(null);
    if (res.success) { load(); }
    else toast.error(res.error || "Failed");
  }

  const checkSummary = (row) => {
    const items = row.lineItems || [];
    const done = items.filter((li) => li.checkStatus === "checked").length;
    return { done, total: items.length };
  };

  async function collectCash(row) {
    const due = Number(row.amountDue ?? row.total ?? 0);
    if (due <= 0) return;
    if (!window.confirm(`Record a cash payment of $${due.toFixed(2)} for "${row.name}"?`)) return;
    setBusyId(row._id);
    const res = await api.post("/api/payment", {
      customerID,
      purchaseID: row._id,
      type: "event_purchase",
      amount: due,
      method: "cash",
      notes: row.name,
    });
    setBusyId(null);
    if (res.success) { toast.success("Payment recorded"); load(); }
    else toast.error(res.error || "Failed to record payment");
  }

  const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const badge = (s) => ({
    paid: "bg-success/10 text-success",
    partial: "bg-amber-500/10 text-amber-600",
    unpaid: "bg-muted text-muted-foreground",
  }[s] || "bg-muted text-muted-foreground");

  if (loading)
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner />
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">
        {rows.length} purchase{rows.length !== 1 ? "s" : ""}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center text-[13px] text-muted-foreground">
          No events or purchases yet. Create one from Setup → “Create Event &amp; Purchase”.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Date", "Purchase", "Event Type", "Total", "Paid", "Due", "Billing", "Check", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const due = Number(r.amountDue ?? r.total ?? 0);
                const open = expandedId === r._id;
                const lineItems = r.lineItems || [];
                const rowPayments = paymentsFor(r._id);
                return (
                  <Fragment key={r._id}>
                    <tr
                      className={`${i > 0 ? "border-t border-border" : ""} hover:bg-muted/20 cursor-pointer`}
                      onClick={() => setExpandedId(open ? null : r._id)}
                    >
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-2.5 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
                          {r.name}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.eventTypeID?.name || "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums">{money(r.total)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-success">{money(r.amountPaid)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{money(due)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${badge(r.billingStatus)}`}>
                          {r.billingStatus || "unpaid"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const { done, total } = checkSummary(r);
                          const all = total > 0 && done === total;
                          return (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${all ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                              {done}/{total} checked
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {due > 0 && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busyId === r._id} onClick={() => collectCash(r)}>
                            {busyId === r._id ? "…" : "Collect cash"}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t border-border bg-muted/20">
                        <td colSpan={9} className="px-4 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Line items</p>
                              <div className="rounded-lg border border-border bg-card overflow-hidden">
                                <table className="w-full text-[12px]">
                                  <thead>
                                    <tr className="bg-muted/40 text-left text-[10px] uppercase text-muted-foreground">
                                      <th className="px-2.5 py-1.5">Item</th>
                                      <th className="px-2.5 py-1.5 text-right">Qty</th>
                                      <th className="px-2.5 py-1.5 text-right">Price</th>
                                      <th className="px-2.5 py-1.5 text-right">Disc.</th>
                                      <th className="px-2.5 py-1.5 text-right">Total</th>
                                      <th className="px-2.5 py-1.5">Check</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {lineItems.length === 0 ? (
                                      <tr><td colSpan={6} className="px-2.5 py-3 text-center text-muted-foreground">No line items.</td></tr>
                                    ) : lineItems.map((li) => (
                                      <tr key={li._id} className="border-t border-border">
                                        <td className="px-2.5 py-1.5">{li.name}</td>
                                        <td className="px-2.5 py-1.5 text-right tabular-nums">{li.quantity}</td>
                                        <td className="px-2.5 py-1.5 text-right tabular-nums">{money(li.unitPrice)}</td>
                                        <td className="px-2.5 py-1.5 text-right tabular-nums">{li.discount ? money(li.discount) : "—"}</td>
                                        <td className="px-2.5 py-1.5 text-right tabular-nums font-medium">{money(li.total)}</td>
                                        <td className="px-2.5 py-1.5">
                                          {li.checkStatus === "checked" ? (
                                            <button type="button" disabled={busyId === li._id} onClick={() => toggleLineCheck(r, li)}
                                              className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success hover:opacity-80">
                                              ✓ {li.checkedAt ? new Date(li.checkedAt).toLocaleDateString() : "checked"}
                                            </button>
                                          ) : li.eventDate ? (
                                            <span className="text-[10px] text-muted-foreground" title="Auto-checks after this time">
                                              auto · {new Date(li.eventDate).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                                            </span>
                                          ) : (
                                            <button type="button" disabled={busyId === li._id} onClick={() => toggleLineCheck(r, li)}
                                              className="rounded border border-border px-2 py-0.5 text-[10px] font-medium hover:bg-muted/60">
                                              {busyId === li._id ? "…" : "Mark checked"}
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {r.notes && <p className="mt-2 text-[12px] text-muted-foreground">Note: {r.notes}</p>}
                            </div>

                            <div className="flex flex-col gap-4">
                              {(() => {
                                const plan = planFor(r._id);
                                if (!plan) return null;
                                return (
                                  <div>
                                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      Payment schedule · {plan.status}
                                    </p>
                                    <div className="rounded-lg border border-border bg-card divide-y divide-border">
                                      {(plan.installments || []).map((inst, idx) => (
                                        <div key={idx} className="flex items-center justify-between px-3 py-2 text-[12px]">
                                          <span className="text-muted-foreground">
                                            #{idx + 1} · {inst.dueDate ? new Date(inst.dueDate).toLocaleDateString() : "—"}
                                          </span>
                                          <span className="flex items-center gap-2">
                                            <span className="tabular-nums font-medium">{money(inst.amount)}</span>
                                            {inst.status === "paid" ? (
                                              <span className="text-success text-[10px] font-medium">paid</span>
                                            ) : inst.status === "payment_pending" ? (
                                              <span className="text-amber-600 text-[10px] font-medium">pending</span>
                                            ) : (
                                              <button type="button" disabled={busyId === `${plan._id}:${idx}`}
                                                onClick={() => payInstallment(plan, idx)}
                                                className="rounded border border-border px-2 py-0.5 text-[10px] font-medium hover:bg-muted/60">
                                                {busyId === `${plan._id}:${idx}` ? "…" : "Record"}
                                              </button>
                                            )}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}

                              <div>
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Payments</p>
                                {rowPayments.length === 0 ? (
                                  <p className="text-[12px] text-muted-foreground">No payments recorded against this purchase yet.</p>
                                ) : (
                                  <div className="rounded-lg border border-border bg-card divide-y divide-border">
                                    {rowPayments.map((p) => (
                                      <div key={p._id} className="flex items-center justify-between px-3 py-2 text-[12px]">
                                        <span className="text-muted-foreground">
                                          {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"} · {p.method}
                                          {p.status !== "completed" ? ` (${p.status})` : ""}
                                        </span>
                                        <span className="tabular-nums font-medium">{money(p.amount)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {r.sourceTemplateID?.name && (
                                  <p className="mt-2 text-[12px] text-muted-foreground">From template: {r.sourceTemplateID.name}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Card &amp; wallet payments: use “Create Event &amp; Purchase”, or record them from Payment History.
      </p>
    </div>
  );
}

function PaymentsTab({ customerID }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [refundTarget, setRefundTarget] = useState(null);
  const LIMIT = 20;

  const load = useCallback(
    async (p = 1) => {
      setLoading(true);
      const payRes = await api.get(
        `/api/payment/customer/${customerID}?page=${p}&limit=${LIMIT}`,
      );
      if (payRes.success) {
        setPayments(payRes.data || []);
        setTotal(payRes.meta?.total ?? payRes.data?.length ?? 0);
      }
      setLoading(false);
    },
    [customerID],
  );

  useEffect(() => {
    load(page);
  }, [load, page]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  if (loading)
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner />
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          {total} transaction{total !== 1 ? "s" : ""}
        </p>
      </div>

      {payments.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center text-[13px] text-muted-foreground">
          No payment records yet.
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {[
                    "Date",
                    "Type",
                    "Amount",
                    "Method",
                    "Package",
                    "Processed By",
                    "Status",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => {
                  return (
                    <tr
                      key={p._id}
                      className={`${i > 0 ? "border-t border-border" : ""} hover:bg-muted/20`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {formatDate(p.createdAt)}
                      </td>

                      <td className="px-4 py-3 capitalize text-muted-foreground">
                        {p.type?.replace(/_/g, " ") ?? "—"}
                      </td>
                      <td
                        className={`px-4 py-3 font-semibold ${p.type === "refund" ? "text-rose-600" : "text-foreground"}`}
                      >
                        {p.type === "refund" ? "-" : ""}$
                        {Number(p.amount).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">
                        {p.method}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.enrollmentID?.package?.packageName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.processedBy?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            p.status === "completed"
                              ? "bg-success/10 text-success"
                              : p.status === "pending"
                                ? "bg-warning/10 text-warning"
                                : "bg-rose-500/10 text-rose-600"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {p.type !== "refund" && p.status === "completed" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-muted-foreground hover:text-rose-600"
                            onClick={() => setRefundTarget(p)}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" /> Refund
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[12px]"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[12px]"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <IssueRefundDialog
        open={Boolean(refundTarget)}
        onClose={() => setRefundTarget(null)}
        payment={refundTarget}
        customerID={customerID}
        onSuccess={() => load(page)}
      />
    </div>
  );
}

// ─── Lessons Tab ──────────────────────────────────────────────────────────────

function deriveEventStatus(ev) {
  const explicit = ev.status;
  if (explicit && explicit !== "scheduled") return explicit;
  if (ev.endDateTime && new Date(ev.endDateTime) < new Date())
    return "completed";
  return explicit || "scheduled";
}

// Whether this event's student has actually paid for it. A package charge is
// only "paid" while the package it draws from is fully collected — a refund that
// drops paymentStatus below "paid" (or amountCollected below totalPaid) flips
// the lesson back to Unpaid, matching the calendar.
function deriveEventPaid(ev) {
  if (ev.payment?.collected) return true;
  if (["credits", "direct", "mixed", "membership"].includes(ev.chargeMethod))
    return true;
  if (ev.chargeMethod === "package" && ev.packageBillingType !== "flexible") {
    const charge = (ev.charges || []).find((c) => c.method === "package");
    const pkg = charge?.enrollmentID?.package ?? charge?.customerPackageID;
    if (!pkg) return true; // no package data on the payload — stay optimistic
    if (pkg.paymentStatus) return pkg.paymentStatus === "paid";
    const collected = Number(pkg.amountCollected ?? 0);
    const total = Number(pkg.totalPaid ?? 0);
    return total > 0 && collected >= total;
  }
  return false;
}

function eventStatusBadge(status) {
  const map = {
    scheduled: "bg-info/10 text-info",
    completed: "bg-success/10 text-success",
    cancelled: "bg-muted text-muted-foreground",
    cancelled_no_charge: "bg-muted text-muted-foreground",
    cancelled_charged: "bg-warning/10 text-warning",
    no_show: "bg-rose-500/10 text-rose-600",
  };
  return map[status] ?? "bg-muted text-muted-foreground";
}

function eventStatusLabel(status) {
  return (
    {
      scheduled: "Scheduled",
      completed: "Completed",
      cancelled: "Cancelled",
      cancelled_no_charge: "Cancelled",
      cancelled_charged: "Cancelled (charged)",
      no_show: "No Show",
    }[status] ?? status
  );
}

// ─── Trial / 1st-purchase Tab ─────────────────────────────────────────────────

const INTRO_STATUS_LABELS = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled_no_charge: "Cancelled",
  cancelled_charged: "Cancelled (charged)",
  no_show_no_charge: "No Show",
  no_show_charged: "No Show (charged)",
  held: "Held",
};

const INTRO_STATUS_PILL = {
  scheduled: "bg-primary/10 text-primary",
  completed: "bg-success/10 text-success",
  cancelled_no_charge: "bg-muted text-muted-foreground",
  cancelled_charged: "bg-muted text-muted-foreground",
  no_show_no_charge: "bg-warning/10 text-warning",
  no_show_charged: "bg-warning/10 text-warning",
  held: "bg-muted text-muted-foreground",
};

function formatIntroDateTime(value, timeZone) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    ...(timeZone ? { timeZone } : {}),
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatIntroDate(value, timeZone) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    ...(timeZone ? { timeZone } : {}),
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatIntroTime(value, timeZone) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("en-US", {
    ...(timeZone ? { timeZone } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatIntroMoney(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return "—";
  return `$${Number(amount).toFixed(2)}`;
}

function groupIntroSlotsByDay(slots, timeZone) {
  const groups = [];
  const map = new Map();
  for (const slot of slots || []) {
    const dayKey = new Date(slot.start).toLocaleDateString("en-US", {
      ...(timeZone ? { timeZone } : {}),
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (!map.has(dayKey)) {
      const g = { dayKey, slots: [] };
      map.set(dayKey, g);
      groups.push(g);
    }
    map.get(dayKey).slots.push(slot);
  }
  return groups;
}

function IntroMetaRow({ label, value, icon: Icon }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/60 last:border-0">
      {Icon ? (
        <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground leading-none mb-1">
          {label}
        </p>
        <p className="text-[13px] font-medium text-foreground break-words">
          {value}
        </p>
      </div>
    </div>
  );
}

function IntroStatusStep({ done, active, label, sub }) {
  return (
    <div className="flex items-start gap-3 min-w-0">
      <div
        className={[
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
          done
            ? "border-success bg-success text-white"
            : active
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-muted-foreground",
        ].join(" ")}
      >
        {done ? <CheckCircle className="h-3.5 w-3.5" /> : null}
      </div>
      <div className="min-w-0">
        <p
          className={`text-[13px] font-medium ${active || done ? "text-foreground" : "text-muted-foreground"}`}
        >
          {label}
        </p>
        {sub && (
          <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

function IntroTab({ customer }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [availSlots, setAvailSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const rescheduleInFlightRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get(`/api/customer/${customer._id}/intro`);
      if (res.success) {
        setData(res.data);
      } else {
        setData(null);
        setLoadError(res.error || "Failed to load trial details.");
        toast.error(res.error || "Failed to load trial details.");
      }
    } catch (err) {
      setData(null);
      setLoadError(err?.message || "Failed to load trial details.");
      toast.error(err?.message || "Failed to load trial details.");
    } finally {
      setLoading(false);
    }
  }, [customer._id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCancel() {
    if (!data?.upcoming || cancelling) return;
    if (
      !confirm(
        "Cancel this trial lesson? No charge will apply. They can rebook free since they already paid.",
      )
    )
      return;
    setCancelling(true);
    try {
      const res = await api.delete(`/api/calendar/${data.upcoming._id}`);
      if (res.success) {
        toast.success("Trial lesson cancelled.");
        setShowRescheduleForm(false);
        await load();
      } else {
        toast.error(res.error || "Failed to cancel.");
      }
    } catch (err) {
      toast.error(err?.message || "Failed to cancel.");
    } finally {
      setCancelling(false);
    }
  }

  async function openReschedule() {
    setShowRescheduleForm(true);
    setSelectedSlot(null);
    setSlotsLoading(true);
    setAvailSlots([]);
    const locationID = Array.isArray(customer.locationID)
      ? customer.locationID[0]?._id || customer.locationID[0]
      : customer.locationID?._id || customer.locationID;
    if (!locationID) {
      toast.error("Customer has no location — cannot load slots.");
      setSlotsLoading(false);
      return;
    }
    try {
      const res = await api.get(
        `/api/calendar/availability?locationID=${locationID}&days=14&maxSlots=20`,
      );
      if (res.success) setAvailSlots(res.data?.slots || res.data || []);
      else toast.error("Failed to load available slots.");
    } catch (err) {
      toast.error(err?.message || "Failed to load available slots.");
    } finally {
      setSlotsLoading(false);
    }
  }

  async function handleReschedule() {
    if (!selectedSlot || rescheduleInFlightRef.current) return;
    rescheduleInFlightRef.current = true;
    setRescheduling(true);
    const locationID = Array.isArray(customer.locationID)
      ? customer.locationID[0]?._id || customer.locationID[0]
      : customer.locationID?._id || customer.locationID;
    const isMovingUpcoming = Boolean(data?.upcoming);

    try {
      // Backend moves an existing upcoming lesson in place, or books a new one if none.
      const res = await api.post(
        `/api/customer/${customer._id}/intro/reschedule`,
        {
          start: selectedSlot.start,
          end: selectedSlot.end,
          locationID,
        },
      );
      if (res.success) {
        toast.success(
          isMovingUpcoming
            ? "Trial lesson rescheduled successfully."
            : "Trial lesson booked successfully.",
        );
        setShowRescheduleForm(false);
        setSelectedSlot(null);
        await load();
      } else {
        toast.error(
          res.error ||
            (isMovingUpcoming ? "Failed to reschedule." : "Failed to book."),
        );
        await load();
      }
    } catch (err) {
      toast.error(
        err?.message ||
          (isMovingUpcoming ? "Failed to reschedule." : "Failed to book."),
      );
      await load();
    } finally {
      rescheduleInFlightRef.current = false;
      setRescheduling(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  if (loadError && !data) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button size="sm" variant="outline" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  const {
    purchase,
    upcoming,
    takenLesson,
    history,
    purchased,
    taken,
    status,
    statusLabel,
    rescheduleBlockReason,
    canBookOrRebook,
    timezone: studioTimezone,
  } = data || {};

  const introConsumed = taken || rescheduleBlockReason === "intro_consumed";
  const hadCancelledTrial = (history || []).some((ev) =>
    String(ev?.status || "").startsWith("cancelled"),
  );
  // Staff: move upcoming in place, or book/rebook when paid + unscheduled.
  const canOpenScheduler =
    Boolean(purchased) &&
    !introConsumed &&
    (Boolean(upcoming) || canBookOrRebook !== false);
  const showSchedulerActions = canOpenScheduler && !showRescheduleForm;
  const schedulingMode = upcoming
    ? "reschedule"
    : hadCancelledTrial
      ? "rebook"
      : "book";
  const originalSlot = purchase?.slot;
  const lessonForTaken = takenLesson || null;
  const slotGroups = groupIntroSlotsByDay(availSlots, studioTimezone);

  const stepPurchased = Boolean(purchased);
  const stepScheduled = Boolean(upcoming) || Boolean(taken);
  const stepTaken = Boolean(taken);

  const resolvedStatus =
    status ||
    (!purchased
      ? "not_purchased"
      : taken
        ? "taken"
        : upcoming
          ? "purchased_scheduled"
          : hadCancelledTrial
            ? "purchased_cancelled"
            : "purchased_not_taken");

  const resolvedStatusLabel =
    statusLabel ||
    {
      not_purchased: "Not purchased",
      purchased_scheduled: "Purchased — scheduled (not taken yet)",
      purchased_cancelled: "Purchased — cancelled (needs rebook)",
      purchased_not_taken: "Purchased — not scheduled yet",
      taken: "Purchased — already taken",
    }[resolvedStatus];

  const heroTone =
    resolvedStatus === "taken"
      ? "border-success/20 bg-success/5"
      : resolvedStatus === "purchased_scheduled"
        ? "border-primary/20 bg-primary/5"
        : resolvedStatus === "purchased_cancelled" ||
            resolvedStatus === "purchased_not_taken"
          ? "border-warning/25 bg-warning/5"
          : "border-border bg-muted/30";

  const heroSubcopy = !purchased
    ? "This customer has not purchased their first trial lesson yet."
    : taken
      ? "Purchase complete and the trial lesson has been taken."
      : upcoming
        ? "Purchased and scheduled — waiting for the lesson."
        : hadCancelledTrial
          ? "Purchased, but the trial was cancelled. Free rebook is available."
          : "Purchased, but not scheduled yet. Book a free time whenever they’re ready.";

  const primaryActionLabel =
    schedulingMode === "reschedule"
      ? "Reschedule"
      : schedulingMode === "rebook"
        ? "Rebook free"
        : "Book trial";

  const confirmActionLabel =
    schedulingMode === "reschedule"
      ? "Confirm reschedule"
      : schedulingMode === "rebook"
        ? "Confirm rebook"
        : "Confirm booking";

  const schedulerTitle =
    schedulingMode === "reschedule"
      ? "Pick a new time"
      : schedulingMode === "rebook"
        ? "Rebook trial"
        : "Schedule trial";

  const schedulerSubcopy =
    schedulingMode === "reschedule"
      ? "Free reschedule — payment already collected. The current booking will move to the new time."
      : schedulingMode === "rebook"
        ? "Free rebook — payment already collected."
        : "Free booking — payment already collected.";

  return (
    <div className="space-y-5">
      {/* Hero status — full width */}
      <div className={`rounded-xl border p-5 md:p-6 ${heroTone}`}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Trial lesson
            </p>
            <h3 className="text-[17px] font-semibold text-foreground leading-snug">
              {resolvedStatusLabel}
            </h3>
            <p className="text-[12px] text-muted-foreground mt-1 max-w-2xl">
              {heroSubcopy}
            </p>
          </div>
          {purchased && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-background/80 border border-border px-2.5 py-1 text-[11px] font-medium text-foreground shrink-0">
              <CheckCircle className="h-3 w-3 text-success" />
              Paid {formatIntroMoney(purchase?.amount)}
            </span>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-4 sm:gap-6">
          <IntroStatusStep
            done={stepPurchased}
            active={!stepPurchased}
            label="Purchased"
            sub={
              purchased
                ? formatIntroDate(purchase?.paidAt, studioTimezone)
                : "Not yet"
            }
          />
          <IntroStatusStep
            done={stepScheduled}
            active={purchased && !upcoming && !taken}
            label="Scheduled"
            sub={
              upcoming
                ? formatIntroDate(upcoming.startDateTime, studioTimezone)
                : taken
                  ? "Was scheduled"
                  : hadCancelledTrial
                    ? "Cancelled — needs rebook"
                    : purchased
                      ? "Needs a time"
                      : "—"
            }
          />
          <IntroStatusStep
            done={stepTaken}
            active={Boolean(upcoming)}
            label="Taken"
            sub={
              taken
                ? INTRO_STATUS_LABELS[lessonForTaken?.status] || "Completed"
                : upcoming
                  ? "Not yet"
                  : "—"
            }
          />
        </div>
      </div>

      {/* Purchase + Lesson — full-width two columns */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Purchase card */}
        <div className="rounded-xl border border-border bg-card p-5 md:p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <Receipt className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-foreground">
                1st Purchase
              </p>
              <p className="text-[11px] text-muted-foreground">
                Payment from AI / booking link
              </p>
            </div>
          </div>

          {purchase ? (
            <div>
              <div className="mb-3 rounded-lg bg-muted/40 px-4 py-3.5">
                <p className="text-[15px] font-semibold text-foreground">
                  {purchase.description || "Trial Lesson"}
                </p>
                <p className="text-[22px] font-semibold tracking-tight mt-0.5">
                  {formatIntroMoney(purchase.amount)}
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-6">
                <IntroMetaRow
                  icon={CheckCircle}
                  label="Payment status"
                  value="Paid"
                />
                <IntroMetaRow
                  icon={Calendar}
                  label="Paid on"
                  value={formatIntroDate(purchase.paidAt, studioTimezone)}
                />
                <IntroMetaRow
                  icon={Send}
                  label="Booked via"
                  value={
                    purchase.channel
                      ? String(purchase.channel).toUpperCase()
                      : null
                  }
                />
                <IntroMetaRow
                  icon={BookOpen}
                  label="Service"
                  value={originalSlot?.serviceType || null}
                />
                <div className="sm:col-span-2">
                  <IntroMetaRow
                    icon={Clock}
                    label="Slot chosen at payment"
                    value={
                      originalSlot?.startDateTime
                        ? formatIntroDateTime(
                            originalSlot.startDateTime,
                            studioTimezone,
                          )
                        : null
                    }
                  />
                </div>
              </div>
              {purchase.slotSelectionRequired && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-[12px] text-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-warning shrink-0" />
                  Payment cleared, but they still need to pick a new time.
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
              <Sparkles className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-[13px] font-medium text-foreground">
                Not purchased yet
              </p>
              <p className="text-[12px] text-muted-foreground mt-1">
                No trial payment on record for this customer.
              </p>
            </div>
          )}
        </div>

        {/* Lesson card */}
        <div className="rounded-xl border border-border bg-card p-5 md:p-6 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-foreground">
                  Lesson
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Current trial booking
                </p>
              </div>
            </div>
            {upcoming && (
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${INTRO_STATUS_PILL[upcoming.status] || "bg-muted text-muted-foreground"}`}
              >
                {INTRO_STATUS_LABELS[upcoming.status] || upcoming.status}
              </span>
            )}
            {!upcoming && taken && lessonForTaken && (
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${INTRO_STATUS_PILL[lessonForTaken.status] || "bg-muted text-muted-foreground"}`}
              >
                {INTRO_STATUS_LABELS[lessonForTaken.status] ||
                  lessonForTaken.status}
              </span>
            )}
          </div>

          <div className="flex-1">
            {upcoming ? (
              <div>
                <div className="rounded-lg bg-muted/40 px-4 py-3.5 mb-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                    Upcoming
                  </p>
                  <p className="text-[16px] font-semibold text-foreground leading-snug">
                    {formatIntroDate(upcoming.startDateTime, studioTimezone)}
                  </p>
                  <p className="text-[14px] text-foreground/80 mt-0.5">
                    {formatIntroTime(upcoming.startDateTime, studioTimezone)}
                    {upcoming.endDateTime
                      ? ` – ${formatIntroTime(upcoming.endDateTime, studioTimezone)}`
                      : ""}
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-x-6">
                  <IntroMetaRow
                    icon={User}
                    label="Teacher"
                    value={upcoming.teacherID?.name || "Not assigned"}
                  />
                  <IntroMetaRow
                    icon={CheckCircle}
                    label="Lesson payment"
                    value={
                      upcoming.payment?.collected
                        ? `Collected${upcoming.payment?.amount != null ? ` (${formatIntroMoney(upcoming.payment.amount)})` : ""}`
                        : upcoming.chargeMethod === "direct"
                          ? "Paid (direct)"
                          : null
                    }
                  />
                  <div className="sm:col-span-2">
                    <IntroMetaRow
                      icon={BookOpen}
                      label="Title"
                      value={upcoming.title || null}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <IntroMetaRow
                      icon={StickyNote}
                      label="Notes"
                      value={upcoming.notes || null}
                    />
                  </div>
                </div>
              </div>
            ) : taken && lessonForTaken ? (
              <div>
                <div className="rounded-lg bg-success/5 border border-success/15 px-4 py-3.5 mb-3">
                  <p className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5 text-success" />
                    Trial already taken
                  </p>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    {formatIntroDateTime(
                      lessonForTaken.startDateTime,
                      studioTimezone,
                    )}
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-x-6">
                  <IntroMetaRow
                    icon={User}
                    label="Teacher"
                    value={lessonForTaken.teacherID?.name || "—"}
                  />
                  <IntroMetaRow
                    icon={CheckCircle}
                    label="Result"
                    value={
                      INTRO_STATUS_LABELS[lessonForTaken.status] ||
                      lessonForTaken.status
                    }
                  />
                  <div className="sm:col-span-2">
                    <IntroMetaRow
                      icon={BookOpen}
                      label="Title"
                      value={lessonForTaken.title || null}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <IntroMetaRow
                      icon={StickyNote}
                      label="Notes"
                      value={lessonForTaken.notes || null}
                    />
                  </div>
                </div>
              </div>
            ) : purchased ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
                <Clock className="h-6 w-6 mx-auto mb-2 text-warning" />
                <p className="text-[13px] font-medium text-foreground">
                  {hadCancelledTrial
                    ? "Trial cancelled — not scheduled"
                    : "Not scheduled yet"}
                </p>
                <p className="text-[12px] text-muted-foreground mt-1 max-w-sm mx-auto">
                  {hadCancelledTrial
                    ? "They already paid — rebook a free time whenever they’re ready."
                    : "They already paid — book a free trial time whenever they’re ready."}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
                <Calendar className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-[13px] font-medium text-foreground">
                  No lesson yet
                </p>
                <p className="text-[12px] text-muted-foreground mt-1">
                  Details appear here after the trial is purchased.
                </p>
              </div>
            )}
          </div>

          {(upcoming || (purchased && !introConsumed)) && (
            <div className="flex flex-wrap gap-2 pt-4 mt-auto border-t border-border">
              {showSchedulerActions && (
                <Button
                  size="sm"
                  variant={upcoming ? "outline" : "default"}
                  onClick={openReschedule}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  {primaryActionLabel}
                </Button>
              )}
              {upcoming && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={handleCancel}
                  disabled={cancelling}
                >
                  <CalendarX className="h-3.5 w-3.5 mr-1.5" />
                  {cancelling ? "Cancelling…" : "Cancel — No Charge"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Reschedule / book picker — full width */}
      {showRescheduleForm && (
        <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-foreground">
                {schedulerTitle}
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {schedulerSubcopy}
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => {
                setShowRescheduleForm(false);
                setSelectedSlot(null);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {slotsLoading && (
            <div className="flex items-center gap-2 py-8 justify-center text-[13px] text-muted-foreground">
              <LoadingSpinner />
              Loading available slots…
            </div>
          )}

          {!slotsLoading && !availSlots.length && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-3 text-[13px] text-muted-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              No open slots found. Try again later.
            </div>
          )}

          {!slotsLoading && slotGroups.length > 0 && (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 max-h-[360px] overflow-y-auto pr-1">
              {slotGroups.map((group) => (
                <div key={group.dayKey}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {group.dayKey}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {group.slots.map((slot) => {
                      const active = selectedSlot?.start === slot.start;
                      return (
                        <button
                          key={slot.start}
                          type="button"
                          onClick={() => setSelectedSlot(slot)}
                          className={[
                            "rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors",
                            active
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted/40",
                          ].join(" ")}
                        >
                          {slot.label ||
                            formatIntroTime(slot.start, studioTimezone)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedSlot && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
              <p className="text-[12px] text-muted-foreground">
                Selected:{" "}
                <span className="font-medium text-foreground">
                  {formatIntroDateTime(selectedSlot.start, studioTimezone)}
                </span>
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedSlot(null)}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={handleReschedule}
                  disabled={rescheduling}
                >
                  {rescheduling ? "Saving…" : confirmActionLabel}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* History — full width */}
      {history && history.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5 md:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-[13px] font-semibold text-foreground">
              Lesson history
            </p>
            <p className="text-[11px] text-muted-foreground">
              {history.length} record{history.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-0">
            {history.map((ev) => {
              const isDone =
                ev.status === "completed" || ev.status === "no_show_charged";
              const isCancel = String(ev.status || "").startsWith("cancelled");
              return (
                <div
                  key={ev._id}
                  className="flex items-start justify-between gap-3 py-3 border-b border-border/60 last:border-0 md:odd:pr-2 md:even:pl-2"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={[
                        "mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border bg-card",
                        isDone
                          ? "border-success/40 text-success"
                          : "border-border text-muted-foreground",
                      ].join(" ")}
                    >
                      {isDone ? (
                        <CheckCircle className="h-3 w-3" />
                      ) : isCancel ? (
                        <XCircle className="h-3 w-3" />
                      ) : (
                        <Clock className="h-3 w-3" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-foreground">
                        {formatIntroDateTime(ev.startDateTime, studioTimezone)}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {[
                          ev.teacherID?.name
                            ? `with ${ev.teacherID.name}`
                            : null,
                          ev.title,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Trial lesson"}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${INTRO_STATUS_PILL[ev.status] || "bg-muted text-muted-foreground"}`}
                  >
                    {INTRO_STATUS_LABELS[ev.status] || ev.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!purchased && !upcoming && (!history || !history.length) && (
        <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <Sparkles className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-[14px] font-medium text-foreground">
            No trial activity yet
          </p>
          <p className="text-[12px] text-muted-foreground mt-1 max-w-md mx-auto">
            When this customer buys and books their first lesson through AI, the
            purchase and lesson details will show up here.
          </p>
        </div>
      )}
    </div>
  );
}

const LESSON_FILTERS = [
  { id: "scheduled", label: "Scheduled" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "no_show", label: "No Show" },
  { id: "paid", label: "Paid" },
  { id: "unpaid", label: "Unpaid" },
];

function LessonsTab({ customer }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilters, setActiveFilters] = useState(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [sortOrder, setSortOrder] = useState("new_to_old");
  const custId = String(customer?._id ?? "");

  useEffect(() => {
    if (!customer?._id) return;
    const past = new Date();
    past.setFullYear(past.getFullYear() - 2);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const params = new URLSearchParams({
      start: past.toISOString(),
      end: future.toISOString(),
      limit: 500,
    });
    api.get(`/api/calendar?${params}`).then((res) => {
      if (res.success && Array.isArray(res.data)) {
        const filtered = res.data
          .filter((ev) => {
            const ids = Array.isArray(ev.customerIDs) ? ev.customerIDs : [];
            return ids.some(
              (c) => String(c?._id ?? c) === String(customer._id),
            );
          })
          .sort(
            (a, b) => new Date(b.startDateTime) - new Date(a.startDateTime),
          );
        setEvents(filtered);
      }
      setLoading(false);
    });
  }, [customer?._id]);

  function toggleFilter(id) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  const filteredEvents = events
    .filter((ev) => {
      if (activeFilters.size === 0) return true;
      const status = deriveEventStatus(ev);
      const isPaid = deriveEventPaid(ev);
      const isCancelledNoCharge =
        status === "cancelled_no_charge" || status === "no_show_no_charge";

      const STATUS_IDS = ["scheduled", "completed", "cancelled", "no_show"];
      const PAYMENT_IDS = ["paid", "unpaid"];
      const selectedStatuses = STATUS_IDS.filter((id) => activeFilters.has(id));
      const selectedPayments = PAYMENT_IDS.filter((id) =>
        activeFilters.has(id),
      );

      const matchesStatus =
        selectedStatuses.length === 0 ||
        (selectedStatuses.includes("scheduled") && status === "scheduled") ||
        (selectedStatuses.includes("completed") && status === "completed") ||
        (selectedStatuses.includes("cancelled") &&
          (status === "cancelled" || isCancelledNoCharge)) ||
        (selectedStatuses.includes("no_show") && status === "no_show");

      const matchesPayment =
        selectedPayments.length === 0 ||
        (selectedPayments.includes("paid") && isPaid && !isCancelledNoCharge) ||
        (selectedPayments.includes("unpaid") &&
          !isPaid &&
          !isCancelledNoCharge);

      return matchesStatus && matchesPayment;
    })
    .sort((a, b) => {
      const diff = new Date(a.startDateTime) - new Date(b.startDateTime);
      return sortOrder === "old_to_new" ? diff : -diff;
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
          {activeFilters.size > 0 ? " · filtered" : ""}
        </p>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border overflow-hidden text-[12px] font-medium">
            <button
              type="button"
              onClick={() => setSortOrder("new_to_old")}
              className={`h-8 px-3 transition-colors ${sortOrder === "new_to_old" ? "bg-brand text-brand-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
            >
              New to Old
            </button>
            <button
              type="button"
              onClick={() => setSortOrder("old_to_new")}
              className={`h-8 px-3 border-l border-border transition-colors ${sortOrder === "old_to_new" ? "bg-brand text-brand-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
            >
              Old to New
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 h-8 rounded-lg border px-3 text-[12px] font-medium transition-colors ${
              showFilters || activeFilters.size > 0
                ? "border-brand bg-brand/10 text-brand"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            Filter
            {activeFilters.size > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-brand-foreground">
                {activeFilters.size}
              </span>
            )}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showFilters ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          {LESSON_FILTERS.map((f) => {
            const active = activeFilters.has(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggleFilter(f.id)}
                className={`h-7 rounded-full px-3 text-[12px] font-medium border transition-colors ${
                  active
                    ? "bg-brand text-brand-foreground border-brand"
                    : "bg-background text-muted-foreground border-border hover:border-primary hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            );
          })}
          {activeFilters.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveFilters(new Set())}
              className="h-7 rounded-full px-3 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {filteredEvents.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center text-[13px] text-muted-foreground">
          No events found
          {activeFilters.size > 0 ? " for the selected filters" : ""}.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {filteredEvents.map((ev, i) => {
            const status = deriveEventStatus(ev);
            const isPersonalNoShow = (ev.noShowIDs || []).some(
              (id) => String(id?._id ?? id) === custId,
            );
            const date = new Date(ev.startDateTime);
            const end = ev.endDateTime ? new Date(ev.endDateTime) : null;
            const instructor = ev.teacherID?.name;
            const label = ev.title || ev.calendarServiceID?.name || "Event";
            const serviceCode =
              ev.calendarServiceID?.serviceCode ?? ev.type ?? "";
            const isPaid = deriveEventPaid(ev);
            const isCancelledNoCharge =
              status === "cancelled_no_charge" ||
              status === "no_show_no_charge";
            const paymentLabel = isCancelledNoCharge
              ? "No Charge"
              : isPaid
                ? "Paid"
                : "Unpaid";
            const paymentClass = isCancelledNoCharge
              ? "bg-muted text-muted-foreground"
              : isPaid
                ? "bg-success/10 text-success"
                : "bg-rose-500/10 text-rose-600";
            return (
              <div
                key={ev._id ?? i}
                className={`flex items-center justify-between px-5 py-4 gap-4 ${i > 0 ? "border-t border-border" : ""}`}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="shrink-0 text-center w-12">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase">
                      {date.toLocaleDateString("en-US", { month: "short" })}
                    </p>
                    <p className="text-[18px] font-bold text-foreground leading-none">
                      {date.getDate()}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">
                      {label}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {date.toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {end &&
                        ` – ${end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
                      {instructor && ` · ${instructor}`}
                    </p>
                    {serviceCode && (
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mt-0.5">
                        {serviceCode}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isPersonalNoShow && (
                    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-warning/10 text-warning">
                      No Show
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${eventStatusBadge(status)}`}
                  >
                    {eventStatusLabel(status)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${paymentClass}`}
                  >
                    {paymentLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── History Tab ────────────────────────────────────────────────────────────
// Surfaces customFields.migrationLegacy — the historic/contextual fields a
// migration import saves (lifetime lesson counts, last lesson date, lifetime
// collected, source, dance level, assigned teacher, key dates) but that have
// no dedicated Customer model column. Previously this data was written on
// import and then never shown anywhere; this tab is the display surface for it.

const HISTORY_DATE_FIELDS = [
  { key: "customerSince", label: "Customer Since" },
  { key: "firstSessionDate", label: "First Session (Intro) Date" },
  { key: "lastLessonDate", label: "Last Lesson Date" },
  { key: "anniversary", label: "Anniversary" },
  { key: "nextAppointmentDate", label: "Next Appointment Date" },
];

const HISTORY_COUNT_FIELDS = [
  { key: "privatesTaken", label: "Privates Taken" },
  { key: "groupsTaken", label: "Groups Taken" },
  { key: "partiesTaken", label: "Parties Taken" },
  { key: "coachingTaken", label: "Coaching Taken" },
];

function HistoryTab({ customer }) {
  const legacy = customer?.customFields?.migrationLegacy || {};
  const hasAnything = Object.keys(legacy).length > 0;

  if (!hasAnything) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-[13px] text-muted-foreground">
          No migration history on file for this customer.
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          This section fills in automatically for customers brought in through a migration import that
          supplied Source, Dance Level, Assigned Teacher, historic lesson counts, Lifetime Collected, or
          key dates.
        </p>
      </div>
    );
  }

  const totalLessons = HISTORY_COUNT_FIELDS.reduce(
    (sum, { key }) => sum + (Number(legacy[key]) || 0),
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 text-[13px] font-semibold text-foreground">Legacy Record</h2>
        <p className="mb-4 text-[12px] text-muted-foreground">
          Carried over from this customer's old system at migration time.
        </p>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {legacy.source && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">Source</p>
              <p className="text-[13px] font-medium text-foreground">{legacy.source}</p>
            </div>
          )}
          {legacy.danceLevel && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">Dance Level</p>
              <p className="text-[13px] font-medium text-foreground">{legacy.danceLevel}</p>
            </div>
          )}
          {legacy.assignedTeacher && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">Assigned Teacher</p>
              <p className="text-[13px] font-medium text-foreground">{legacy.assignedTeacher}</p>
            </div>
          )}
          {legacy.lifetimeCollected !== undefined && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">Lifetime Collected</p>
              <p className="text-[13px] font-medium text-foreground">
                ${Number(legacy.lifetimeCollected).toFixed(2)}
              </p>
            </div>
          )}
          {HISTORY_DATE_FIELDS.map(
            ({ key, label }) =>
              legacy[key] && (
                <div key={key}>
                  <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
                  <p className="text-[13px] font-medium text-foreground">{formatDate(legacy[key])}</p>
                </div>
              ),
          )}
        </div>
      </div>

      {totalLessons > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-[13px] font-semibold text-foreground">Historic Lesson Counts</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {HISTORY_COUNT_FIELDS.map(({ key, label }) => (
              <div key={key} className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
                <p className="text-[19px] font-semibold text-foreground">
                  {Number(legacy[key]) || 0}
                </p>
              </div>
            ))}
            <div className="rounded-xl border border-border bg-primary/5 px-4 py-3">
              <p className="text-[11px] text-muted-foreground mb-1">Total</p>
              <p className="text-[19px] font-semibold text-primary">{totalLessons}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Notes Tab ────────────────────────────────────────────────────────────────

function NotesTab({ customer, onUpdated }) {
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [pinningId, setPinningId] = useState(null);
  const toast = useToast();

  const notes = [...(customer.notes || [])].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  async function handleAdd(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setAdding(true);
    const res = await api.post(`/api/customer/${customer._id}/notes`, {
      text: text.trim(),
    });
    if (res.success) {
      toast.success("Note added.");
      setText("");
      onUpdated();
    } else toast.error(res.error || "Failed.");
    setAdding(false);
  }

  async function handlePin(noteId) {
    setPinningId(noteId);
    await api.patch(`/api/customer/${customer._id}/notes/${noteId}`);
    onUpdated();
    setPinningId(null);
  }

  async function handleDelete(noteId) {
    setDeletingId(noteId);
    const res = await api.delete(
      `/api/customer/${customer._id}/notes/${noteId}`,
    );
    if (res.success) {
      toast.success("Note deleted.");
      onUpdated();
    } else toast.error(res.error || "Failed.");
    setDeletingId(null);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note…"
          className="flex-1 h-9 rounded-lg border border-border bg-card px-3 text-[13px] outline-none focus:border-primary"
        />
        <Button
          type="submit"
          size="sm"
          className="h-9 px-4 text-[12px]"
          disabled={adding || !text.trim()}
        >
          {adding ? "Adding…" : "Add"}
        </Button>
      </form>

      {notes.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center text-[13px] text-muted-foreground">
          No notes yet.
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <div
              key={note._id}
              className={`rounded-xl border bg-card px-4 py-3.5 ${note.isPinned ? "border-primary/30 bg-primary/5" : "border-border"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13px] text-foreground leading-relaxed flex-1">
                  {note.text}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                    disabled={pinningId === note._id}
                    onClick={() => handlePin(note._id)}
                  >
                    {note.isPinned ? (
                      <PinOff className="h-3.5 w-3.5" />
                    ) : (
                      <Pin className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={deletingId === note._id}
                    onClick={() => handleDelete(note._id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                {formatDate(note.createdAt)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CustomerDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [customer, setCustomer] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("profile");

  const load = useCallback(async () => {
    const [custRes, locRes] = await Promise.all([
      api.get(`/api/customer/${id}`),
      api.get("/api/location?limit=200"),
    ]);
    if (custRes.success) setCustomer(custRes.data);
    if (locRes.success) setLocations(locRes.data || []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
          <LoadingSpinner />
        </div>
      </MainLayout>
    );
  }

  if (!customer) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-[calc(100vh-8rem)] gap-4">
          <p className="text-[13px] text-muted-foreground">
            Customer not found.
          </p>
          <Button variant="outline" onClick={() => router.back()}>
            Go back
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="w-full px-6 py-6 space-y-6">
        {/* Back + header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="text-[13px] font-semibold bg-primary/10 text-primary">
                {getInitials(customer.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-foreground truncate">
                  {customer.name}
                </h1>
                <span
                  className={[
                    "inline-flex flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    customerLifecycleBadgeClass(customer.lifecycleStatus),
                  ].join(" ")}
                >
                  {customerLifecycleLabel(customer.lifecycleStatus)}
                </span>
              </div>
              <p className="text-[13px] text-muted-foreground truncate">
                {customer.email}
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-border">
          {TABS.map(({ id: tabId, label, Icon }) => (
            <button
              key={tabId}
              type="button"
              onClick={() => setTab(tabId)}
              className={[
                "flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors",
                tab === tabId
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {tab === "profile" && (
            <ProfileTab
              customer={customer}
              locations={locations}
              onUpdated={load}
            />
          )}
          {tab === "intro" && <IntroTab customer={customer} />}
          {tab === "active-enrollments" && (
            <EnrollmentsTab
              customerID={customer._id}
              customerName={customer.name || customer.email || ""}
              locationID={resolveLocationID(customer)}
            />
          )}
          {tab === "memberships" && (
            <CustomerMembershipsTab
              customerID={customer._id}
              customerName={customer.name || customer.email || ""}
              locationID={resolveLocationID(customer)}
            />
          )}
          {tab === "wallet" && <CustomerWalletTab customerID={customer._id} />}
          {tab === "purchases" && <PurchasesTab customerID={customer._id} />}
          {tab === "payments" && <PaymentsTab customerID={customer._id} />}
          {tab === "lessons" && <LessonsTab customer={customer} />}
          {tab === "history" && <HistoryTab customer={customer} />}
          {tab === "notes" && <NotesTab customer={customer} onUpdated={load} />}
          {tab === "members" && (
            <MembersTab customer={customer} onUpdated={load} />
          )}
          {tab === "contracts" && <ContractsTab customerID={customer._id} />}
        </div>
      </div>
    </MainLayout>
  );
}

// ─── Members Tab ─────────────────────────────────────────────────────────────

const MEMBER_GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const EMPTY_MEMBER = {
  name: "",
  email: "",
  phoneNumber: "",
  gender: "",
  dateOfBirth: "",
  relationship: "",
  notes: "",
};

function MemberFormSheet({ open, onClose, customerId, member, onSaved }) {
  const [form, setForm] = useState(EMPTY_MEMBER);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();
  const isEdit = Boolean(member?._id);

  useEffect(() => {
    if (open) {
      setForm(
        member
          ? {
              name: member.name || "",
              email: member.email || "",
              phoneNumber: member.phoneNumber || "",
              gender: member.gender || "",
              dateOfBirth: member.dateOfBirth
                ? String(member.dateOfBirth).slice(0, 10)
                : "",
              relationship: member.relationship || "",
              notes: member.notes || "",
            }
          : EMPTY_MEMBER,
      );
      setError(null);
    }
  }, [open, member]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      email: form.email || undefined,
      phoneNumber: form.phoneNumber || undefined,
      gender: form.gender || undefined,
      dateOfBirth: form.dateOfBirth || undefined,
      relationship: form.relationship || undefined,
      notes: form.notes || undefined,
    };
    const result = isEdit
      ? await api.put(
          `/api/customer/${customerId}/members/${member._id}`,
          payload,
        )
      : await api.post(`/api/customer/${customerId}/members`, payload);
    if (result.success) {
      toast.success(isEdit ? "Member updated." : "Member added.");
      onSaved();
      onClose();
    } else {
      setError(result.error || "Something went wrong.");
    }
    setSaving(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? "Edit Member" : "Add Member"}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4 px-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-muted-foreground">
                Name<span className="text-destructive ml-0.5">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Full name"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-muted-foreground">
                Relationship
              </label>
              <input
                type="text"
                value={form.relationship}
                onChange={(e) => set("relationship", e.target.value)}
                placeholder="e.g. Spouse, Partner"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-muted-foreground">
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="Optional"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-muted-foreground">
                Phone
              </label>
              <input
                type="tel"
                value={form.phoneNumber}
                onChange={(e) => set("phoneNumber", e.target.value)}
                placeholder="Optional"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-muted-foreground">
                Date of Birth
              </label>
              <input
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-muted-foreground">
                Gender
              </label>
              <div className="relative">
                <select
                  value={form.gender}
                  onChange={(e) => set("gender", e.target.value)}
                  className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[13px] outline-none focus:border-primary"
                >
                  <option value="">Select…</option>
                  {MEMBER_GENDER_OPTIONS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="block text-[12px] font-medium text-muted-foreground">
                Notes
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Any notes about this member"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
              />
            </div>
          </div>
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Member"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function MembersTab({ customer, onUpdated }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const toast = useToast();

  const members = customer.members || [];

  async function handleDelete(memberId) {
    if (!window.confirm("Remove this member?")) return;
    setDeletingId(memberId);
    const res = await api.delete(
      `/api/customer/${customer._id}/members/${memberId}`,
    );
    if (res.success) {
      toast.success("Member removed.");
      onUpdated();
    } else toast.error(res.error || "Failed to remove member.");
    setDeletingId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          {members.length} member{members.length !== 1 ? "s" : ""} on this
          account
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditingMember(null);
            setSheetOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Member
        </Button>
      </div>

      {members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-[13px] text-muted-foreground">
            No members added yet.
          </p>
          <p className="text-[12px] text-muted-foreground mt-1">
            Add a family member or partner to this account.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {members.map((m) => (
            <div
              key={m._id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-[12px] font-semibold text-primary">
                    {(m.name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">
                      {m.name}
                    </p>
                    {m.relationship && (
                      <p className="text-[11px] text-muted-foreground capitalize">
                        {m.relationship}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditingMember(m);
                      setSheetOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    disabled={deletingId === m._id}
                    onClick={() => handleDelete(m._id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="text-[12px] text-muted-foreground space-y-0.5 pl-11">
                {m.email && <p>{m.email}</p>}
                {m.phoneNumber && <p>{m.phoneNumber}</p>}
                {m.dateOfBirth && (
                  <p>DOB: {new Date(m.dateOfBirth).toLocaleDateString()}</p>
                )}
                {m.gender && (
                  <p className="capitalize">{m.gender.replace(/_/g, " ")}</p>
                )}
                {m.notes && <p className="italic">"{m.notes}"</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <MemberFormSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        customerId={customer._id}
        member={editingMember}
        onSaved={onUpdated}
      />
    </div>
  );
}

// ─── Contracts Tab ─────────────────────────────────────────────────────────────

const CONTRACT_STATUS_STYLES = {
  draft: "bg-muted text-foreground",
  sent: "bg-info/10 text-info",
  signed: "bg-success/10 text-success",
  expired: "bg-warning/10 text-warning",
  revoked: "bg-destructive/10 text-destructive",
};

function ContractFormSheet({ open, onClose, customerId, contract, onSaved }) {
  const [form, setForm] = useState({ title: "", content: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();
  const isEdit = Boolean(contract?._id);

  useEffect(() => {
    if (open) {
      setForm(
        contract
          ? {
              title: contract.title || "",
              content: contract.content || "",
              notes: contract.notes || "",
            }
          : { title: "", content: "", notes: "" },
      );
      setError(null);
    }
  }, [open, contract]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      setError("Title and content are required.");
      return;
    }
    setSaving(true);
    const payload = {
      customerID: customerId,
      title: form.title.trim(),
      content: form.content.trim(),
      notes: form.notes || undefined,
    };
    const result = isEdit
      ? await api.put(`/api/contract/${contract._id}`, payload)
      : await api.post("/api/contract", payload);
    if (result.success) {
      toast.success(isEdit ? "Contract updated." : "Contract created.");
      onSaved();
      onClose();
    } else {
      setError(result.error || "Something went wrong.");
    }
    setSaving(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-xl">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? "Edit Contract" : "New Contract"}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4 px-6">
          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-muted-foreground">
              Title<span className="text-destructive ml-0.5">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Enrollment Agreement"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-muted-foreground">
              Contract Content<span className="text-destructive ml-0.5">*</span>
            </label>
            <textarea
              value={form.content}
              onChange={(e) => set("content", e.target.value)}
              rows={10}
              placeholder="Enter the full contract text here…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-primary resize-y"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-muted-foreground">
              Internal Notes
            </label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Staff notes (not shown to customer)"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
            />
          </div>
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Contract"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ContractsTab({ customerID }) {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingContract, setEditingContract] = useState(null);
  const [viewingContract, setViewingContract] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get(
      `/api/contract?customerID=${customerID}&limit=50`,
    );
    if (res.success) setContracts(res.data || []);
    setLoading(false);
  }, [customerID]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSend(c) {
    if (!window.confirm(`Send "${c.title}" to the customer for signing?`))
      return;
    setSendingId(c._id);
    const res = await api.post(`/api/contract/${c._id}/send`, {});
    if (res.success) {
      toast.success("Contract sent for signing.");
      load();
    } else toast.error(res.error || "Failed to send.");
    setSendingId(null);
  }

  async function handleRevoke(c) {
    if (!window.confirm(`Revoke "${c.title}"?`)) return;
    const res = await api.post(`/api/contract/${c._id}/revoke`, {});
    if (res.success) {
      toast.success("Contract revoked.");
      load();
    } else toast.error(res.error || "Failed to revoke.");
  }

  async function handleDelete(c) {
    if (!window.confirm(`Delete "${c.title}"?`)) return;
    const res = await api.delete(`/api/contract/${c._id}`);
    if (res.success) {
      toast.success("Contract deleted.");
      load();
    } else toast.error(res.error || "Failed to delete.");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          {contracts.length} contract{contracts.length !== 1 ? "s" : ""}
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditingContract(null);
            setSheetOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" /> New Contract
        </Button>
      </div>

      {loading ? (
        <div className="py-10 text-center text-[13px] text-muted-foreground">
          Loading…
        </div>
      ) : contracts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-[13px] text-muted-foreground">No contracts yet.</p>
          <p className="text-[12px] text-muted-foreground mt-1">
            Create a contract and send it to the customer for digital signing.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {contracts.map((c) => (
            <div
              key={c._id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[13px] font-medium text-foreground truncate">
                      {c.title}
                    </p>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize shrink-0 ${CONTRACT_STATUS_STYLES[c.status] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {c.status}
                    </span>
                  </div>
                  {c.signedByName && (
                    <p className="text-[12px] text-success">
                      Signed by {c.signedByName} · {formatDate(c.signedAt)}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Created {formatDate(c.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="View"
                    onClick={() => setViewingContract(c)}
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </Button>
                  {c.status === "draft" && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Edit"
                        onClick={() => {
                          setEditingContract(c);
                          setSheetOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-info hover:text-info"
                        title="Send for signing"
                        disabled={sendingId === c._id}
                        onClick={() => handleSend(c)}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Delete"
                        onClick={() => handleDelete(c)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  {c.status === "sent" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-warning hover:text-warning"
                      title="Revoke"
                      onClick={() => handleRevoke(c)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ContractFormSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        customerId={customerID}
        contract={editingContract}
        onSaved={load}
      />

      {/* View contract dialog */}
      <Dialog
        open={Boolean(viewingContract)}
        onClose={() => setViewingContract(null)}
      >
        <DialogContent
          className="max-w-2xl max-h-[90vh] overflow-y-auto"
          onClose={() => setViewingContract(null)}
        >
          <DialogHeader>
            <DialogTitle>{viewingContract?.title}</DialogTitle>
          </DialogHeader>
          {viewingContract && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${CONTRACT_STATUS_STYLES[viewingContract.status]}`}
                >
                  {viewingContract.status}
                </span>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-[13px] text-foreground whitespace-pre-wrap max-h-72 overflow-y-auto">
                {viewingContract.content}
              </div>
              {viewingContract.signedByName && (
                <div className="rounded-lg border border-success/20 bg-success/10 p-3 text-[12px] text-success space-y-0.5">
                  <p className="font-semibold">Signature Record</p>
                  <p>Signed by: {viewingContract.signedByName}</p>
                  <p>
                    Date: {new Date(viewingContract.signedAt).toLocaleString()}
                  </p>
                  {viewingContract.signedByIp && (
                    <p>IP: {viewingContract.signedByIp}</p>
                  )}
                </div>
              )}
              {viewingContract.notes && (
                <p className="text-[12px] text-muted-foreground">
                  Notes: {viewingContract.notes}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
