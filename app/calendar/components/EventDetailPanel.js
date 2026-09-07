"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ArrowLeft,
  Pencil,
  Trash2,
  Plus,
  X,
  Users,
} from "lucide-react";
import api from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { studioWallTimeToUtcISO, utcToStudioWallTime } from "@/lib/studio-time";
import { openCheckoutTab, navigateCheckoutTab, closeCheckoutTab } from "@/lib/clover";
import { PAYMENT_METHODS } from "@/lib/paymentMethods";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import LocationSelector from "@/components/shared/LocationSelector";
import MiniStudentPanel from "./MiniStudentPanel";
import CreateEnrollmentSheet from "@/components/enrollment/CreateEnrollmentSheet";

const STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "cancelled_no_charge", label: "Cancelled – No Charge" },
  { value: "cancelled_charged", label: "Cancelled – Charged" },
  { value: "no_show_no_charge", label: "No Show – No Charge" },
  { value: "no_show_charged", label: "No Show – Charged" },
];

const TYPE_OPTIONS = [
  { value: "lesson", label: "Lesson" },
  { value: "trial", label: "Trial" },
  { value: "private", label: "Private" },
  { value: "event", label: "Event" },
];

function Label({ children }) {
  return (
    <label className="block mb-1 text-[11px] font-medium text-muted-foreground">
      {children}
    </label>
  );
}

function Field({ label, children, error }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function ReadValue({ children }) {
  return (
    <p className="text-[13px] font-medium text-foreground truncate">
      {children || <span className="text-muted-foreground">—</span>}
    </p>
  );
}

function Input({ value, onChange }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary"
    />
  );
}

function DateInput({ value, onChange }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary"
    />
  );
}

function TimeInput({ value, onChange }) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary"
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[12px] text-foreground outline-none focus:border-primary"
      >
        <option value="">Select…</option>
        {options.map((opt, i) => (
          <option key={opt.value ?? i} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

const STATUS_META = {
  scheduled: { cls: "bg-info/10 text-info", label: "Scheduled" },
  completed: { cls: "bg-success/10 text-success", label: "Completed" },
  cancelled_no_charge: {
    cls: "bg-muted-foreground/10 text-muted-foreground",
    label: "Cancelled",
  },
  cancelled_charged: {
    cls: "bg-destructive/10 text-destructive",
    label: "Cancelled – Charged",
  },
  no_show_no_charge: {
    cls: "bg-warning/10 text-warning",
    label: "No Show",
  },
  no_show_charged: {
    cls: "bg-warning/10 text-warning",
    label: "No Show – Charged",
  },
};

// An unallocated lesson is real and scheduled but paid for by nothing. It must
// never read as an ordinary booking, and — unlike every other scheduled event —
// it does not silently become "Completed" once its time passes.
function isUnallocated(event) {
  return event?.allocation?.status === "unallocated";
}

// One stable id for a funding option regardless of which kind it is — the three
// id fields are mutually exclusive.
function fundingKey(t) {
  return String(
    t.enrollmentID ?? t.customerPackageID ?? t.customerMembershipID ?? "",
  );
}

function UnallocatedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
      <AlertTriangle className="h-3 w-3" />
      Unallocated
    </span>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta?.cls || "bg-muted text-muted-foreground"}`}
    >
      {meta?.label || status}
    </span>
  );
}

function formatDisplayDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDisplayTime(iso, tz) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    ...(tz ? { timeZone: tz } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── New customer form for group class ───────────────────────────────────────

function NewGroupCustomerForm({ onSuccess, onCancel }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [locationID, setLocationID] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (!Array.isArray(locationID) || locationID.length === 0) {
      setError("Please select at least one location.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await api.post("/api/customer", {
      name: name.trim(),
      email: email.trim(),
      phoneNumber: phone.trim() || undefined,
      locationID,
    });
    if (!res.success || !res.data) {
      setError(res.error || "Failed to create customer.");
      setSaving(false);
      return;
    }
    setSaving(false);
    onSuccess(res.data);
  }

  const inputCls =
    "h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-primary transition-colors";

  return (
    <div className="p-6 space-y-5">
      <div>
        <p className="text-[15px] font-semibold text-foreground">
          New Customer
        </p>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Create a customer then sell them a package
        </p>
      </div>
      <div className="space-y-3">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1">
            Full Name *
          </p>
          <input
            className={inputCls}
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1">
            Email *
          </p>
          <input
            className={inputCls}
            placeholder="Email address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1">
            Phone
          </p>
          <input
            className={inputCls}
            placeholder="Phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1">
            Location *
          </p>
          <LocationSelector
            value={locationID}
            onChange={setLocationID}
            multiple
            showAllOption={false}
            placeholder="Select location(s)…"
          />
        </div>
      </div>
      {error && <p className="text-[12px] text-rose-600">{error}</p>}
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 h-9 rounded-lg border border-border text-[13px] font-medium text-foreground hover:bg-muted/50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={saving}
          className="flex-1 h-9 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Creating…" : "Next: Sell Package"}
        </button>
      </div>
    </div>
  );
}

// ─── Group student roster (add / remove customers with group packages) ────────

function getFundingOptionId(opt) {
  return opt.customerMembershipID || opt.enrollmentID || opt.customerPackageID;
}

function GroupStudentRoster({
  eventId,
  serviceCode,
  servicePrice,
  onRosterChanged,
  onSelectStudent,
}) {
  // Fetch everything from scratch so we always have the live server state
  const [enrolled, setEnrolled] = useState([]);
  const [allCustomers, setAllCustomers] = useState([]);
  const [groupCustomerIds, setGroupCustomerIds] = useState(new Set());
  const [membershipCustomerIds, setMembershipCustomerIds] = useState(new Set());
  const [groupServiceCodes, setGroupServiceCodes] = useState(new Set());
  const [sessionMap, setSessionMap] = useState({}); // customerID -> { sessionsRemaining, packageName }
  const [chargedIds, setChargedIds] = useState(new Set()); // customerIDs that have a charge record
  const [noShowIds, setNoShowIds] = useState(new Set()); // customerIDs marked as no-show
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sellOpen, setSellOpen] = useState(false);
  const [sellQuery, setSellQuery] = useState("");
  const [sellCustomer, setSellCustomer] = useState(null); // customer being sold a group package
  const sellDropRef = useRef(null);
  const pendingSellRef = useRef(null);
  const [newCustomerSheetOpen, setNewCustomerSheetOpen] = useState(false);
  const [saving, setSaving] = useState(null);
  const [payingId, setPayingId] = useState(null); // student currently showing the pay form
  const [payForm, setPayForm] = useState({ amount: "", method: "cash" });
  const [pendingAdd, setPendingAdd] = useState(null); // { customer, memberIds: [], absent } - waiting for member selection
  const [editingMembersId, setEditingMembersId] = useState(null); // customerId currently editing attending members
  const [editingMemberIds, setEditingMemberIds] = useState([]); // draft member selection while editing
  const [editingAbsent, setEditingAbsent] = useState(false); // draft "customer not attending" flag while editing
  const [enrolledMemberMap, setEnrolledMemberMap] = useState({}); // customerId -> [memberId, ...]
  const [eventMemberIds, setEventMemberIds] = useState([]); // flat list of persisted member subdoc ids
  const [absentCustomerIds, setAbsentCustomerIds] = useState(new Set()); // customerIDs whose member attends in their place
  const [fundingChoicePrompt, setFundingChoicePrompt] = useState(null); // { context: 'add' | 'edit', options }

  const dropRef = useRef(null);

  // Fetch the event's current customerIDs then resolve each to a full customer object
  const fetchEnrolled = async () => {
    const evRes = await api.get(`/api/calendar/${eventId}`);
    if (!evRes.success) return;
    const customerIds = (evRes.data?.customerIDs || [])
      .map((c) => (typeof c === "object" ? String(c._id) : String(c)))
      .filter(Boolean);
    const persistedMemberIds = (evRes.data?.memberIDs || []).map((m) =>
      String(m?._id ?? m),
    );
    setEventMemberIds(persistedMemberIds);
    const charges = evRes.data?.charges || [];
    const charged = new Set(charges.map((ch) => String(ch.customerID)));
    setChargedIds(charged);
    // Prefer the package/membership this event actually charged against — the
    // roster's fallback (scanning all active enrollments) can pick a different,
    // unrelated package when a customer holds more than one.
    const chargeSMap = {};
    charges.forEach((ch) => {
      const cid = String(ch.customerID?._id ?? ch.customerID ?? "");
      if (!cid) return;
      const code = ch.serviceCode || serviceCode;
      let svc = null;
      let packageName = "";
      if (ch.method === "package") {
        const services =
          ch.customerPackageID?.services || ch.enrollmentID?.package?.services;
        svc = services?.find((s) => s.serviceCode === code)
          ?? services?.find((s) => (s.pricePerSession ?? 0) > 0);
        packageName = ch.enrollmentID?.package?.packageName || svc?.serviceName || "";
      } else if (ch.method === "membership") {
        svc = ch.customerMembershipID?.services?.find((s) => s.serviceCode === code);
      }
      if (svc) {
        chargeSMap[cid] = {
          sessionsRemaining: svc.sessionsRemaining,
          packageName,
        };
      }
    });
    setSessionMap((prev) => ({ ...prev, ...chargeSMap }));
    const noShows = new Set(
      (evRes.data?.noShowIDs || []).map((id) => String(id?._id ?? id)),
    );
    setNoShowIds(noShows);
    setAbsentCustomerIds(
      new Set(
        (evRes.data?.absentCustomerIDs || []).map((id) =>
          String(id?._id ?? id),
        ),
      ),
    );
    if (customerIds.length === 0) {
      setEnrolled([]);
      setEnrolledMemberMap({});
      return;
    }
    const results = await Promise.all(
      customerIds.map((id) => api.get(`/api/customer/${id}`)),
    );
    const customers = results.filter((r) => r.success).map((r) => r.data);
    setEnrolled(customers);
    // Seed the per-customer member map from persisted memberIDs so existing
    // attendance shows in the roster when the panel reopens.
    const memberSet = new Set(persistedMemberIds);
    const map = {};
    customers.forEach((c) => {
      const mine = (c.members || [])
        .filter((m) => memberSet.has(String(m._id)))
        .map((m) => String(m._id));
      if (mine.length > 0) map[String(c._id)] = mine;
    });
    setEnrolledMemberMap(map);
  };

  const loadRosterData = async () => {
    const [customersRes, pkgRes, servicesRes, membershipRes] =
      await Promise.all([
        api.get("/api/customer?limit=500"),
        api.get("/api/customer-package?limit=500"),
        api.get("/api/calendar-service?limit=200"),
        api.get("/api/customer-membership?status=active&limit=500"),
      ]);
    const groupCodes = new Set(
      (servicesRes.success ? servicesRes.data : [])
        .filter((s) => s.type === "group")
        .map((s) => s.serviceCode),
    );
    const ids = new Set();
    const sMap = {};
    (pkgRes.success ? pkgRes.data : []).forEach((enrollment) => {
      const pkgServices = enrollment.package?.services ?? [];
      const isActive =
        enrollment.status === "active" && enrollment.package?.status === "active";
      if (
        isActive &&
        pkgServices.some(
          (s) => groupCodes.has(s.serviceCode) && (s.sessionsRemaining ?? 0) > 0,
        )
      ) {
        const cid = String(
          enrollment.customerID?._id ?? enrollment.customerID ?? "",
        );
        if (cid) ids.add(cid);
      }
      // Build sessions-remaining map for this event's service
      if (
        serviceCode &&
        enrollment.status === "active" &&
        enrollment.package?.status === "active"
      ) {
        const cid = String(
          enrollment.customerID?._id ?? enrollment.customerID ?? "",
        );
        const svc = (enrollment.package?.services ?? []).find(
          (s) => s.serviceCode === serviceCode,
        );
        if (cid && svc != null) {
          const heldSince = new Date(
            enrollment.purchaseDate ?? enrollment.createdAt ?? 0,
          ).getTime();
          const prev = sMap[cid];
          if (prev == null || heldSince < prev.heldSince) {
            sMap[cid] = {
              heldSince,
              sessionsRemaining: svc.sessionsRemaining,
              packageName:
                enrollment.package?.packageName || svc.serviceName || "",
            };
          }
        }
      }
    });
    setGroupServiceCodes(groupCodes);
    setGroupCustomerIds(ids);
    setSessionMap(sMap);

    // Membership customers — those with an active membership covering this event's serviceCode
    const membershipIds = new Set();
    (membershipRes.success ? membershipRes.data : []).forEach((m) => {
      if (m.status !== "active") return;
      const covers = (m.services || []).some(
        (s) => !serviceCode || s.serviceCode === serviceCode,
      );
      if (covers) {
        const cid = String(m.customerID?._id ?? m.customerID ?? "");
        if (cid) membershipIds.add(cid);
      }
    });
    setMembershipCustomerIds(membershipIds);

    if (customersRes.success) setAllCustomers(customersRes.data);
  };

  useEffect(() => {
    async function load() {
      setLoadingRoster(true);
      await loadRosterData();
      await fetchEnrolled();
      setLoadingRoster(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    if (!addOpen) return;
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setAddOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addOpen]);

  useEffect(() => {
    if (!sellOpen) return;
    const handler = (e) => {
      if (sellDropRef.current && !sellDropRef.current.contains(e.target)) {
        setSellOpen(false);
        setSellQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sellOpen]);

  const currentIds = new Set(enrolled.map((c) => String(c._id)));

  const eligibleToAdd = allCustomers.filter((c) => {
    const cid = String(c._id);
    return (
      (groupCustomerIds.has(cid) || membershipCustomerIds.has(cid)) &&
      !currentIds.has(cid)
    );
  });

  const filtered = query.trim()
    ? eligibleToAdd.filter((c) =>
        (c.name || c.email || "").toLowerCase().includes(query.toLowerCase()),
      )
    : eligibleToAdd;

  // "Sell Group Class" is for students who can't already book this event — i.e.
  // the complement of "Add Student": not enrolled, and holding no active package
  // or membership with a group-type service covering it.
  const sellCandidates = allCustomers.filter((c) => {
    const cid = String(c._id);
    return (
      !currentIds.has(cid) &&
      !groupCustomerIds.has(cid) &&
      !membershipCustomerIds.has(cid)
    );
  });
  const sellFiltered = sellQuery.trim()
    ? sellCandidates.filter((c) =>
        (c.name || c.email || "")
          .toLowerCase()
          .includes(sellQuery.toLowerCase()),
      )
    : sellCandidates;

  const handleSellSuccess = async () => {
    const customer = pendingSellRef.current;
    pendingSellRef.current = null;
    if (customer && !currentIds.has(String(customer._id))) {
      await confirmAdd(customer, []);
    }
    await loadRosterData();
  };

  const handleAdd = (customer) => {
    setFundingChoicePrompt(null);
    if ((customer.members || []).length > 0) {
      setPendingAdd({ customer, memberIds: [], absent: false });
      setAddOpen(false);
      setQuery("");
      return;
    }
    confirmAdd(customer, [], false);
  };

  const confirmAdd = async (
    customer,
    memberIds,
    absent = false,
    fundingChoice = null,
  ) => {
    const cid = String(customer._id);
    setSaving(cid);
    const newIds = [...currentIds, cid];
    // memberIDs is a flat list across all customers on the event — merge with the
    // existing ones so we never clobber another student's attending members.
    const mergedMemberIds = Array.from(
      new Set([...eventMemberIds.map(String), ...memberIds.map(String)]),
    );
    const mergedAbsentIds = Array.from(
      new Set([...[...absentCustomerIds].map(String), ...(absent ? [cid] : [])]),
    );
    const body = {
      customerIDs: newIds,
      memberIDs: mergedMemberIds,
      absentCustomerIDs: mergedAbsentIds,
      ...(fundingChoice ? { fundingChoice } : {}),
    };
    const res = await api.put(`/api/calendar/${eventId}`, body);
    if (res.success) {
      const charged = new Set(
        (res.data?.charges || []).map((ch) => String(ch.customerID)),
      );
      setChargedIds(charged);
      setEnrolled((prev) => [...prev, customer]);
      setEventMemberIds(mergedMemberIds);
      if (memberIds.length > 0) {
        setEnrolledMemberMap((prev) => ({
          ...prev,
          [cid]: memberIds.map(String),
        }));
      }
      if (absent) {
        setAbsentCustomerIds(
          (prev) => new Set([...prev, cid]),
        );
      }
      const memberNames = (customer.members || [])
        .filter((m) => memberIds.map(String).includes(String(m._id)))
        .map((m) => m.name)
        .filter(Boolean);
      onRosterChanged?.(
        memberNames.length > 0
          ? { eventId, customerId: cid, memberNames }
          : null,
      );
      setFundingChoicePrompt(null);
      setPendingAdd(null);
    } else if (res.errorData?.needsFundingChoice) {
      // The funding-choice prompt lives inside the pending-add panel, so a
      // members-less customer (added via the direct confirmAdd path) needs that
      // panel opened here or the prompt has nowhere to render and the click
      // appears to do nothing.
      setPendingAdd((prev) => prev || { customer, memberIds, absent });
      setAddOpen(false);
      setQuery("");
      setFundingChoicePrompt({
        context: "add",
        options: res.errorData.options || [],
      });
    } else {
      setPendingAdd(null);
    }
    setSaving(null);
  };

  const handleRemove = async (customerId) => {
    setSaving(customerId);
    const newIds = [...currentIds].filter((id) => id !== customerId);
    // Drop the removed student's members from the event-wide memberIDs list.
    const removed = enrolled.find((c) => String(c._id) === String(customerId));
    const removedMemberIds = new Set(
      (removed?.members || []).map((m) => String(m._id)),
    );
    const newMemberIds = eventMemberIds.filter(
      (id) => !removedMemberIds.has(String(id)),
    );
    const newAbsentIds = [...absentCustomerIds].filter(
      (id) => id !== customerId,
    );
    const res = await api.put(`/api/calendar/${eventId}`, {
      customerIDs: newIds,
      memberIDs: newMemberIds,
      absentCustomerIDs: newAbsentIds,
    });
    if (res.success) {
      const charged = new Set(
        (res.data?.charges || []).map((ch) => String(ch.customerID)),
      );
      setChargedIds(charged);
      setEnrolled((prev) => prev.filter((c) => String(c._id) !== customerId));
      setEventMemberIds(newMemberIds);
      setAbsentCustomerIds(new Set(newAbsentIds));
      setEnrolledMemberMap((prev) => {
        const next = { ...prev };
        delete next[String(customerId)];
        return next;
      });
      onRosterChanged?.();
    }
    setSaving(null);
  };

  const startEditMembers = (customerId) => {
    setFundingChoicePrompt(null);
    setEditingMembersId(customerId);
    setEditingMemberIds(enrolledMemberMap[customerId] || []);
    setEditingAbsent(absentCustomerIds.has(customerId));
  };

  const confirmEditMembers = async (fundingChoice = null) => {
    if (editingAbsent && editingMemberIds.length === 0) return;
    const cid = editingMembersId;
    setSaving(cid);
    const otherMemberIds = eventMemberIds.filter((id) => {
      const owner = enrolled.find((c) =>
        (c.members || []).some((m) => String(m._id) === String(id)),
      );
      return owner && String(owner._id) !== String(cid);
    });
    const newMemberIds = Array.from(
      new Set([...otherMemberIds, ...editingMemberIds].map(String)),
    );
    const newAbsentIds = editingAbsent
      ? Array.from(new Set([...absentCustomerIds, cid]))
      : [...absentCustomerIds].filter((id) => id !== cid);
    const res = await api.put(`/api/calendar/${eventId}`, {
      memberIDs: newMemberIds,
      absentCustomerIDs: newAbsentIds,
      ...(fundingChoice ? { fundingChoice } : {}),
    });
    if (res.success) {
      setEventMemberIds(newMemberIds);
      setAbsentCustomerIds(new Set(newAbsentIds));
      setEnrolledMemberMap((prev) => {
        const next = { ...prev };
        if (editingMemberIds.length > 0) next[cid] = editingMemberIds;
        else delete next[cid];
        return next;
      });
      onRosterChanged?.();
      setFundingChoicePrompt(null);
      setEditingMembersId(null);
      setEditingMemberIds([]);
      setEditingAbsent(false);
    } else if (res.errorData?.needsFundingChoice) {
      setFundingChoicePrompt({
        context: "edit",
        options: res.errorData.options || [],
      });
    } else {
      setEditingMembersId(null);
      setEditingMemberIds([]);
      setEditingAbsent(false);
    }
    setSaving(null);
  };

  const handleNoShow = async (cid) => {
    setSaving(cid);
    const next = new Set(noShowIds);
    next.has(cid) ? next.delete(cid) : next.add(cid);
    const res = await api.put(`/api/calendar/${eventId}`, {
      noShowIDs: [...next],
    });
    if (res.success) {
      setNoShowIds(next);
      onRosterChanged?.();
    }
    setSaving(null);
  };

  const openPayForm = (cid) => {
    setPayingId(cid);
    setPayForm({
      amount: servicePrice != null ? String(servicePrice) : "",
      method: "cash",
    });
  };

  const handleDirectPay = async (cid) => {
    const checkoutTab = payForm.method === "card" ? openCheckoutTab() : null;
    setSaving(cid);
    const res = await api.post(`/api/calendar/${eventId}/charge-student`, {
      customerID: cid,
      method: payForm.method,
      amount: payForm.amount !== "" ? Number(payForm.amount) : undefined,
    });
    if (res.success) {
      if (res.data?.checkoutUrl) navigateCheckoutTab(checkoutTab, res.data.checkoutUrl);
      else closeCheckoutTab(checkoutTab);
      const charges = res.data?.charges || [];
      const charged = new Set(charges.map((ch) => String(ch.customerID)));
      setChargedIds(charged);
      setPayingId(null);
    } else {
      closeCheckoutTab(checkoutTab);
      await fetchEnrolled();
    }
    // Always refresh the calendar so the event badge + tooltip update
    onRosterChanged?.();
    setSaving(null);
  };

  if (loadingRoster) {
    return (
      <div className="flex items-center gap-2 py-3 text-[12px] text-muted-foreground">
        <svg
          className="h-3.5 w-3.5 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
        Loading students…
      </div>
    );
  }

  return (
    <div>
      {pendingAdd && (
        <div className="mb-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 space-y-2">
          <p className="text-[12px] font-semibold text-foreground">
            Adding{" "}
            <span className="text-primary">{pendingAdd.customer.name}</span> —
            select attending members{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
            :
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(pendingAdd.customer.members || []).map((m) => {
              const selected = pendingAdd.memberIds.includes(String(m._id));
              return (
                <button
                  key={m._id}
                  type="button"
                  onClick={() => {
                    const set = new Set(pendingAdd.memberIds);
                    selected
                      ? set.delete(String(m._id))
                      : set.add(String(m._id));
                    setPendingAdd((p) => ({ ...p, memberIds: [...set] }));
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <span className="h-4 w-4 rounded-full bg-current/20 flex items-center justify-center text-[8px] font-bold shrink-0">
                    {(m.name || "?").charAt(0).toUpperCase()}
                  </span>
                  {m.name}
                  {m.relationship && (
                    <span className="opacity-60 capitalize">
                      · {m.relationship}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {pendingAdd.memberIds.length > 0 && (
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={pendingAdd.absent}
                onChange={(e) =>
                  setPendingAdd((p) => ({ ...p, absent: e.target.checked }))
                }
              />
              {pendingAdd.customer.name} is not attending — member(s) attend
              alone
            </label>
          )}
          {fundingChoicePrompt?.context === "add" && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 px-2.5 py-2 space-y-1.5">
              <p className="text-[11px] font-semibold text-warning">
                Multiple ways to pay — choose one:
              </p>
              <div className="flex flex-col gap-1">
                {fundingChoicePrompt.options.map((opt) => (
                  <button
                    key={getFundingOptionId(opt)}
                    type="button"
                    onClick={() =>
                      confirmAdd(
                        pendingAdd.customer,
                        pendingAdd.memberIds,
                        pendingAdd.absent,
                        { source: opt.source, id: getFundingOptionId(opt) },
                      )
                    }
                    className="h-7 px-2.5 rounded-md border border-border bg-background text-left text-[11px] font-medium text-foreground hover:bg-muted/50"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              onClick={() =>
                confirmAdd(
                  pendingAdd.customer,
                  pendingAdd.memberIds,
                  pendingAdd.absent,
                )
              }
              disabled={saving === String(pendingAdd.customer._id)}
              className="h-7 px-3 rounded-md bg-primary text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {saving === String(pendingAdd.customer._id)
                ? "Adding…"
                : "Confirm & Add"}
            </button>
            <button
              type="button"
              onClick={() => confirmAdd(pendingAdd.customer, [], false)}
              disabled={saving === String(pendingAdd.customer._id)}
              className="h-7 px-3 rounded-md border border-border text-[11px] font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
            >
              Add without member
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-1.5">
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          Students ({enrolled.length})
        </label>
        <div className="flex items-center gap-1.5">
          <div ref={sellDropRef} className="relative">
            <button
              type="button"
              onClick={() => setSellOpen((v) => !v)}
              className="flex items-center gap-1 h-6 px-2 rounded-md border border-primary/40 bg-primary/5 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus className="h-3 w-3" /> Sell Group Class
            </button>
            {sellOpen && (
              <div className="absolute right-0 top-[calc(100%+4px)] z-50 w-60 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
                <div className="p-2 border-b border-border">
                  <input
                    autoFocus
                    type="text"
                    value={sellQuery}
                    onChange={(e) => setSellQuery(e.target.value)}
                    placeholder="Search students without a group package…"
                    className="h-7 w-full rounded-md border border-border bg-muted/30 px-2.5 text-[11px] text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto py-1">
                  {sellFiltered.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">
                      {sellCandidates.length === 0
                        ? "Every student already has a group package or membership"
                        : "No results"}
                    </p>
                  ) : (
                    <>
                      {sellFiltered.map((c) => (
                        <button
                          key={String(c._id)}
                          type="button"
                          onClick={() => {
                            pendingSellRef.current = c;
                            setSellCustomer(c);
                            setSellOpen(false);
                            setSellQuery("");
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-foreground hover:bg-muted/40 transition-colors"
                        >
                          <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
                            {(c.name || "?").charAt(0).toUpperCase()}
                          </span>
                          <span className="truncate">{c.name || c.email}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setSellOpen(false);
                          setSellQuery("");
                          setNewCustomerSheetOpen(true);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-primary font-medium hover:bg-muted/40 transition-colors border-t border-border"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0" />
                        New Customer
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <div ref={dropRef} className="relative">
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              className="flex items-center gap-1 h-6 px-2 rounded-md border border-border bg-background text-[11px] font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              <Plus className="h-3 w-3" /> Add Student
            </button>
            {addOpen && (
              <div className="absolute right-0 top-[calc(100%+4px)] z-50 w-56 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
                <div className="p-2 border-b border-border">
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search students…"
                    className="h-7 w-full rounded-md border border-border bg-muted/30 px-2.5 text-[11px] text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto py-1">
                  {filtered.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">
                      {eligibleToAdd.length === 0
                        ? "No eligible students (need group package)"
                        : "No results"}
                    </p>
                  ) : (
                    filtered.map((c) => {
                      const cid = String(c._id);
                      const isAdding = saving === cid;
                      return (
                        <button
                          key={cid}
                          type="button"
                          disabled={isAdding}
                          onClick={() => handleAdd(c)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                        >
                          <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
                            {isAdding ? (
                              <svg
                                className="h-3 w-3 animate-spin"
                                viewBox="0 0 24 24"
                                fill="none"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                                />
                              </svg>
                            ) : (
                              (c.name || "?").charAt(0).toUpperCase()
                            )}
                          </span>
                          <span className="truncate flex items-center gap-1.5">
                            {c.name || c.email}
                            {(c.members || []).length > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                & {c.members.map((m) => m.name).join(", ")}
                              </span>
                            )}
                            {membershipCustomerIds.has(String(c._id)) && (
                              <span className="text-[9px] font-medium bg-brand/10 text-brand px-1 py-0.5 rounded shrink-0">
                                membership
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {enrolled.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/10 px-3 py-4 text-center">
          <p className="text-[12px] text-muted-foreground">
            No students enrolled yet
          </p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
            Add a group package, or sell one to a new student
          </p>
        </div>
      ) : (
        <div className="space-y-2 mt-1">
          {enrolled.map((c) => {
            const cid = String(c._id);
            const session = sessionMap[cid];
            const remaining = session?.sessionsRemaining;
            const isCharged = chargedIds.has(cid);
            const attendingMemberIds = enrolledMemberMap[cid] || [];
            const attendingMembers = (c.members || []).filter((m) =>
              attendingMemberIds.includes(String(m._id)),
            );
            const isAbsent = absentCustomerIds.has(cid);
            const memberNamesJoined = attendingMembers
              .map((m) => m.name)
              .join(", ");
            const displayName =
              attendingMembers.length > 0
                ? isAbsent
                  ? memberNamesJoined
                  : `${c.name || "—"} & ${memberNamesJoined}`
                : c.name || "—";
            return (
              <div key={cid}>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex items-center gap-2">
                  <span className="h-7 w-7 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                    {(
                      (isAbsent && attendingMembers[0]?.name) ||
                      c.name ||
                      "?"
                    )
                      .charAt(0)
                      .toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <p
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectStudent?.(cid, c.name || "Student")}
                        className="text-[13px] font-semibold text-foreground truncate hover:text-primary hover:underline cursor-pointer"
                      >
                        {displayName}
                      </p>
                      {(c.members || []).length > 0 && (
                        <button
                          type="button"
                          onClick={() => startEditMembers(cid)}
                          className="shrink-0 text-muted-foreground hover:text-primary"
                          aria-label="Edit attending members"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    {membershipCustomerIds.has(cid) ? (
                      <p className="text-[11px] text-brand truncate">
                        Membership
                      </p>
                    ) : (
                      session?.packageName && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {session.packageName}
                        </p>
                      )
                    )}
                    {c.email && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {c.email}
                      </p>
                    )}
                  </div>
                  {remaining != null && !(remaining === 0 && isCharged) && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${remaining <= 2 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}
                    >
                      {remaining} left
                    </span>
                  )}
                  {!isCharged && !membershipCustomerIds.has(cid) && (
                    <button
                      type="button"
                      onClick={() =>
                        payingId === cid ? setPayingId(null) : openPayForm(cid)
                      }
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-warning/10 text-warning hover:bg-warning/20 transition-colors"
                    >
                      Unpaid
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={saving === cid}
                    onClick={() => handleNoShow(cid)}
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                      noShowIds.has(cid)
                        ? "bg-warning/15 text-warning hover:bg-warning/25"
                        : "bg-muted text-muted-foreground hover:bg-warning/10 hover:text-warning"
                    }`}
                  >
                    {noShowIds.has(cid) ? "No Show" : "No Show?"}
                  </button>
                  <button
                    type="button"
                    disabled={saving === cid}
                    onClick={() => handleRemove(cid)}
                    className="shrink-0 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                    aria-label="Remove student"
                  >
                    {saving === cid ? (
                      <svg
                        className="h-3 w-3 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                      </svg>
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                  </button>
                </div>
                {/* end student row */}
                {editingMembersId === cid && (
                  <div className="mt-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 space-y-2">
                    <p className="text-[12px] font-semibold text-foreground">
                      Attending members{" "}
                      <span className="text-muted-foreground font-normal">
                        (select who is attending alongside {c.name})
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {(c.members || []).map((m) => {
                        const selected = editingMemberIds.includes(
                          String(m._id),
                        );
                        return (
                          <button
                            key={m._id}
                            type="button"
                            onClick={() => {
                              const set = new Set(editingMemberIds);
                              selected
                                ? set.delete(String(m._id))
                                : set.add(String(m._id));
                              setEditingMemberIds([...set]);
                            }}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
                              selected
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:bg-muted/50"
                            }`}
                          >
                            <span className="h-4 w-4 rounded-full bg-current/20 flex items-center justify-center text-[8px] font-bold shrink-0">
                              {(m.name || "?").charAt(0).toUpperCase()}
                            </span>
                            {m.name}
                            {m.relationship && (
                              <span className="opacity-60 capitalize">
                                · {m.relationship}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {editingMemberIds.length > 0 && (
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={editingAbsent}
                          onChange={(e) => setEditingAbsent(e.target.checked)}
                        />
                        {c.name} is not attending — member(s) attend alone
                      </label>
                    )}
                    {fundingChoicePrompt?.context === "edit" && (
                      <div className="rounded-lg border border-warning/40 bg-warning/5 px-2.5 py-2 space-y-1.5">
                        <p className="text-[11px] font-semibold text-warning">
                          Multiple ways to pay — choose one:
                        </p>
                        <div className="flex flex-col gap-1">
                          {fundingChoicePrompt.options.map((opt) => (
                            <button
                              key={getFundingOptionId(opt)}
                              type="button"
                              onClick={() =>
                                confirmEditMembers({
                                  source: opt.source,
                                  id: getFundingOptionId(opt),
                                })
                              }
                              className="h-7 px-2.5 rounded-md border border-border bg-background text-left text-[11px] font-medium text-foreground hover:bg-muted/50"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => confirmEditMembers()}
                        disabled={
                          saving === cid ||
                          (editingAbsent && editingMemberIds.length === 0)
                        }
                        className="h-7 px-3 rounded-md bg-primary text-[11px] font-semibold text-white disabled:opacity-50"
                      >
                        {saving === cid ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMembersId(null);
                          setEditingMemberIds([]);
                          setEditingAbsent(false);
                          setFundingChoicePrompt(null);
                        }}
                        disabled={saving === cid}
                        className="h-7 px-3 rounded-md border border-border text-[11px] font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {payingId === cid && (
                  <div className="mt-1.5 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-semibold text-warning">
                      Record session payment
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block mb-1 text-[10px] font-medium text-muted-foreground">
                          Amount ($)
                        </label>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                            $
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={payForm.amount}
                            onChange={(e) =>
                              setPayForm((p) => ({
                                ...p,
                                amount: e.target.value,
                              }))
                            }
                            placeholder="0.00"
                            className="h-8 w-full rounded-md border border-border bg-background pl-5 pr-2 text-[11px] text-foreground outline-none focus:border-warning/40"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block mb-1 text-[10px] font-medium text-muted-foreground">
                          Method
                        </label>
                        <div className="relative">
                          <select
                            value={payForm.method}
                            onChange={(e) =>
                              setPayForm((p) => ({
                                ...p,
                                method: e.target.value,
                              }))
                            }
                            className="h-8 w-full appearance-none rounded-md border border-border bg-background px-2 pr-6 text-[11px] text-foreground outline-none focus:border-warning/40"
                          >
                            {PAYMENT_METHODS.map((m) => (
                              <option key={m.value} value={m.value}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPayingId(null)}
                        className="flex-1 h-7 rounded-md border border-border bg-background text-[11px] font-medium text-muted-foreground hover:bg-muted/40"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={saving === cid}
                        onClick={() => handleDirectPay(cid)}
                        className="flex-1 h-7 rounded-md bg-warning text-[11px] font-semibold text-white hover:bg-warning disabled:opacity-60"
                      >
                        {saving === cid ? "Charging…" : "Charge"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <CreateEnrollmentSheet
        open={!!sellCustomer}
        customerID={sellCustomer?._id}
        customerName={sellCustomer?.name}
        locationID={(() => {
          const loc = sellCustomer?.locationID
          if (!loc) return undefined
          if (Array.isArray(loc)) return loc[0]?._id || loc[0] || undefined
          return loc._id || loc
        })()}
        allowedServiceCodes={groupServiceCodes}
        onClose={() => setSellCustomer(null)}
        onSuccess={handleSellSuccess}
      />

      <Sheet open={newCustomerSheetOpen} onOpenChange={setNewCustomerSheetOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md overflow-y-auto"
        >
          <NewGroupCustomerForm
            onSuccess={(newCustomer) => {
              setNewCustomerSheetOpen(false);
              pendingSellRef.current = newCustomer;
              setSellCustomer(newCustomer);
            }}
            onCancel={() => setNewCustomerSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function EventDetailPanel({
  event,
  open,
  onClose,
  onUpdated,
  onDeleted,
  onRosterChanged,
  onPaymentSuccess,
  studioTz,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [updateScope, setUpdateScope] = useState("this"); // 'this' | 'all'
  const [deleteScope, setDeleteScope] = useState("this"); // 'this' | 'all'
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [selectedStudentName, setSelectedStudentName] = useState("");
  // Unallocated-lesson flow: `allocating` opens the package picker,
  // `allocationTargets` is null until the fetch lands (so the panel can show a
  // loading state), and `overridePrompt` holds the retry for a comp.
  const [allocating, setAllocating] = useState(false);
  const [allocationTargets, setAllocationTargets] = useState(null);
  const [overridePrompt, setOverridePrompt] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");
  // Rebooking a cancelled lesson the student can no longer fund hits the same
  // 409 as the original booking, so it gets the same confirm-and-retry.
  const [rebookPrompt, setRebookPrompt] = useState(null);
  // Which package/membership funds this lesson, and what else could. Loaded
  // when the edit form opens; null while in flight.
  const [fundingOptions, setFundingOptions] = useState(null);
  const [fundingChoice, setFundingChoice] = useState("");
  const [fundingBusy, setFundingBusy] = useState(false);
  const isRecurring = Boolean(event.recurrenceGroupID);
  // Group Class appointments (type "lesson") carry a multi-student roster
  // managed via GroupStudentRoster — the single-customer field/payload below
  // must not touch customerIDs for these, or saving would collapse the
  // roster down to one student.
  const isGroupClass = event.type === "lesson";

  // Reset to the appointment view whenever the panel is closed so reopening a
  // booking always lands on the appointment details rather than a previously
  // opened student account.
  useEffect(() => {
    if (!open) {
      setSelectedStudentId(null);
      setSelectedStudentName("");
      setIsEditing(false);
    }
  }, [open]);

  const [teacherOptions, setTeacherOptions] = useState([]);
  const [customerOptions, setCustomerOptions] = useState([]);
  const [customerDetails, setCustomerDetails] = useState([]);
  const [teacherDetail, setTeacherDetail] = useState(null);

  // Seeded in the STUDIO's timezone (utcToStudioWallTime), matching both the
  // read-only view above (which formats with studioTz) and handleUpdate
  // below (which re-encodes with studioWallTimeToUtcISO/studioTz) — using
  // the browser's local time here instead (the old toDateInputValue/
  // toTimeInputValue) would show a different time than what's actually on
  // the calendar whenever the browser's timezone differs from the studio's,
  // and silently save a shifted time if the user "corrects" a field that
  // only looked wrong.
  const buildFormFromEvent = (ev) => {
    const { date, time: start_time } = utcToStudioWallTime(ev.startDateTime, studioTz);
    const { time: end_time } = utcToStudioWallTime(ev.endDateTime, studioTz);
    return {
      title: ev.title || "",
      date,
      start_time,
      end_time,
      teacherID: String(ev.teacherID?._id ?? ev.teacherID ?? ""),
      customerID: String(ev.customerIDs?.[0]?._id ?? ev.customerIDs?.[0] ?? ""),
      // Use effectiveStatus (auto-completed for past events) if no explicit terminal status
      status: ev.effectiveStatus || ev.status || "scheduled",
      type: ev.type || "",
      notes: ev.notes || "",
      payment_collected: ev.payment?.collected || false,
      payment_amount: ev.payment?.amount != null ? String(ev.payment.amount) : "",
      payment_method: ev.payment?.method || "",
    };
  };

  const [form, setForm] = useState(() => buildFormFromEvent(event));

  // Only private appointments have a single funding source to show. A group
  // class charges each student on the roster separately, so its funding is
  // managed per-student from the roster view, not from this one field.
  const fundingEditable = !isGroupClass && event?.type !== "event";

  useEffect(() => {
    if (!isEditing || !fundingEditable || !event?._id) {
      setFundingOptions(null);
      setFundingChoice("");
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await api.get(`/api/calendar/${event._id}/allocation-targets`);
      if (cancelled) return;
      const targets = res.success && Array.isArray(res.data) ? res.data : [];
      setFundingOptions(targets);
      setFundingChoice(fundingKey(targets.find((t) => t.current) ?? {}) || "");
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditing, fundingEditable, event?._id]);

  // Moving the lesson to another program deducts from the new one and returns
  // the session to the old, so it is applied on its own rather than folded into
  // the form's PUT — a failed move must not silently drop the other edits.
  const applyFundingChange = async () => {
    const target = (fundingOptions ?? []).find(
      (t) => fundingKey(t) === fundingChoice,
    );
    if (!target || target.current) return true;
    setFundingBusy(true);
    const res = await api.post(`/api/calendar/${event._id}/allocate`, {
      enrollmentID: target.enrollmentID,
      customerPackageID: target.customerPackageID,
      customerMembershipID: target.customerMembershipID,
    });
    setFundingBusy(false);
    if (!res.success) {
      setError(res.error || "Failed to change the package for this lesson.");
      return false;
    }
    return true;
  };

  // This panel stays mounted across event selections (its `open` prop just
  // toggles visibility — see app/calendar/page.js), so `useState`'s initial
  // value above only ever ran once, on this component's very first mount —
  // almost certainly before any event was selected. Without this, every
  // field stays stuck on whatever (likely blank) event that first render
  // saw, forever, regardless of which event you actually open. Re-derive
  // fresh whenever a different event is selected, or whenever you re-enter
  // edit mode (picks up anything that changed since the form was last built,
  // e.g. after a save elsewhere).
  useEffect(() => {
    setForm(buildFormFromEvent(event));
  }, [event._id]);

  useEffect(() => {
    if (isEditing) setForm(buildFormFromEvent(event));
  }, [isEditing]);

  const setField = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  useEffect(() => {
    async function loadOptions() {
      const [teachersRes, customersRes] = await Promise.all([
        api.get("/api/teacher?limit=200&status=active"),
        api.get("/api/customer?limit=200"),
      ]);
      if (teachersRes.success && Array.isArray(teachersRes.data)) {
        setTeacherOptions(
          teachersRes.data.map((t) => ({
            value: String(t._id ?? t.id),
            label: t.name || t.email || String(t._id),
          })),
        );
      }
      if (customersRes.success && Array.isArray(customersRes.data)) {
        setCustomerOptions(
          customersRes.data.map((c) => ({
            value: String(c._id ?? c.id),
            label: c.name || c.email || String(c._id),
          })),
        );
      }
    }
    loadOptions();
  }, []);

  useEffect(() => {
    async function loadDetails() {
      const customerIds = (event.customerIDs || [])
        .map((c) => (typeof c === "object" ? c._id : c))
        .filter(Boolean);
      const teacherId = event.teacherID?._id ?? event.teacherID ?? null;

      const [customerResults, teacherRes] = await Promise.all([
        Promise.all(customerIds.map((id) => api.get(`/api/customer/${id}`))),
        teacherId
          ? api.get(`/api/teacher/${teacherId}`)
          : Promise.resolve(null),
      ]);

      setCustomerDetails(
        customerResults.filter((r) => r.success).map((r) => r.data),
      );
      setTeacherDetail(teacherRes?.success ? teacherRes.data : null);
    }
    loadDetails();
  }, [event._id]);

  const handleUpdate = async () => {
    setError(null);
    setIsSaving(true);
    // Same studio-timezone rule as creating an event: interpret the typed
    // time as wall-clock time at the studio's location, not the browser's.
    const startDateTime = studioWallTimeToUtcISO(form.date, form.start_time, studioTz);
    const endDateTime = studioWallTimeToUtcISO(form.date, form.end_time, studioTz);

    const payload = {
      title: form.title,
      startDateTime,
      endDateTime,
      teacherID: form.teacherID || undefined,
      // Group Class rosters are edited via GroupStudentRoster, not this
      // single-select field — leave customerIDs untouched so saving other
      // fields doesn't wipe the roster down to one student.
      customerIDs: isGroupClass
        ? undefined
        : form.customerID
          ? [form.customerID]
          : undefined,
      status: form.status,
      type: form.type || undefined,
      notes: form.notes || undefined,
      payment: form.payment_collected
        ? {
            amount:
              form.payment_amount !== ""
                ? Number(form.payment_amount)
                : undefined,
            method: form.payment_method || undefined,
            collected: true,
          }
        : { collected: false },
    };

    const url =
      isRecurring && updateScope === "all"
        ? `/api/calendar/${event._id}?updateAll=true`
        : `/api/calendar/${event._id}`;
    // Funding first: if it fails the user keeps the open form and their other
    // edits, rather than having them saved against the wrong package.
    if (fundingChoice && !(await applyFundingChange())) {
      setIsSaving(false);
      return;
    }

    const result = await api.put(url, payload);
    if (result.success) {
      setIsEditing(false);
      onUpdated?.();
    } else if (result.errorData?.needsAllocationOverride) {
      setOverridePrompt({
        retry: (reason) =>
          api.put(url, {
            ...payload,
            allocationOverride: true,
            allocationOverrideReason: reason || undefined,
          }),
      });
    } else if (result.errorData?.needsUnallocatedConfirm) {
      setRebookPrompt({
        message: result.error,
        retry: () => api.put(url, { ...payload, allowUnallocated: true }),
      });
    } else {
      setError(result.error || "Failed to update event.");
    }
    setIsSaving(false);
  };

  const confirmRebookUnallocated = async () => {
    const prompt = rebookPrompt;
    if (!prompt) return;
    setRebookPrompt(null);
    setIsSaving(true);
    const res = await prompt.retry();
    if (res.success) {
      setIsEditing(false);
      onUpdated?.();
    } else {
      setError(res.error || "Failed to update event.");
    }
    setIsSaving(false);
  };

  const handleQuickStatus = async (newStatus) => {
    setError(null);
    setOverridePrompt(null);
    setIsSaving(true);
    const body = { status: newStatus };
    const result = await api.put(`/api/calendar/${event._id}`, body);
    if (result.success) {
      onUpdated?.();
      onClose();
    } else if (result.errorData?.needsAllocationOverride) {
      // Completing a lesson no program paid for is a comp, and needs both a
      // deliberate confirmation and the permission to make one.
      setOverridePrompt({
        retry: (reason) =>
          api.put(`/api/calendar/${event._id}`, {
            ...body,
            allocationOverride: true,
            allocationOverrideReason: reason || undefined,
          }),
      });
    } else {
      setError(result.error || "Failed to update status.");
    }
    setIsSaving(false);
  };

  // Load the packages this unallocated lesson could be attached to, on demand.
  const openAllocation = async () => {
    setError(null);
    setAllocating(true);
    setAllocationTargets(null);
    const res = await api.get(`/api/calendar/${event._id}/allocation-targets`);
    if (res.success) {
      setAllocationTargets(res.data || []);
    } else {
      setError(res.error || "Failed to load packages.");
      setAllocating(false);
    }
  };

  const allocateTo = async (target) => {
    setError(null);
    setIsSaving(true);
    const res = await api.post(`/api/calendar/${event._id}/allocate`, {
      enrollmentID: target.enrollmentID,
      customerPackageID: target.customerPackageID,
      customerMembershipID: target.customerMembershipID,
    });
    if (res.success) {
      setAllocating(false);
      setAllocationTargets(null);
      onUpdated?.();
    } else {
      setError(res.error || "Failed to allocate lesson.");
    }
    setIsSaving(false);
  };

  const confirmOverride = async () => {
    const prompt = overridePrompt;
    if (!prompt) return;
    setOverridePrompt(null);
    setIsSaving(true);
    const res = await prompt.retry(overrideReason);
    if (res.success) {
      onUpdated?.();
      onClose();
    } else {
      setError(res.error || "Failed to complete lesson.");
    }
    setOverrideReason("");
    setIsSaving(false);
  };

  const handleDelete = async () => {
    setError(null);
    setIsDeleting(true);
    const params = new URLSearchParams({ hard: "true" });
    if (isRecurring && deleteScope === "all") params.set("deleteAll", "true");
    const result = await api.delete(`/api/calendar/${event._id}?${params}`);
    if (result.success) {
      onDeleted?.();
      onClose();
    } else {
      setError(result.error || "Failed to delete event.");
    }
    setIsDeleting(false);
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetContent onClose={onClose} className="flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 sm:px-5 py-4 shrink-0">
          {selectedStudentId ? (
            <button
              type="button"
              onClick={() => {
                setSelectedStudentId(null);
                setSelectedStudentName("");
              }}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground"
            >
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
              {selectedStudentName}
            </button>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate text-[14px] font-semibold text-foreground">
                {event.title}
              </span>
              {/* An unallocated lesson is held out of auto-completion, so
                  effectiveStatus must not present a past one as Completed. */}
              <StatusBadge
                status={
                  isUnallocated(event)
                    ? event.status
                    : event.effectiveStatus || event.status
                }
              />
              {isUnallocated(event) && <UnallocatedBadge />}
            </div>
          )}
          {!selectedStudentId && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              // mr-9 clears space for SheetContent's own close (X) button,
              // which is absolutely positioned at right-4 top-4 with a
              // higher z-index — without this margin the two buttons land
              // in the same top-right corner and the close button's opaque
              // background visually covers this one entirely, making Edit
              // look like it doesn't exist even though it's still rendered
              // and clickable underneath.
              className="grid h-7 w-7 mr-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Edit event"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {selectedStudentId ? (
            <MiniStudentPanel
              customerId={selectedStudentId}
              customerName={selectedStudentName}
              studioTz={studioTz}
              onBack={() => {
                setSelectedStudentId(null);
                setSelectedStudentName("");
              }}
              inline
              onPaymentSuccess={onPaymentSuccess}
            />
          ) : (
            <>
              {isEditing ? (
                <>
                  <Field label="Title">
                    <Input
                      value={form.title}
                      onChange={(v) => setField("title", v)}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Status">
                      <Select
                        value={form.status}
                        onChange={(v) => setField("status", v)}
                        options={STATUS_OPTIONS}
                      />
                    </Field>
                    <Field label="Type">
                      <Select
                        value={form.type}
                        onChange={(v) => setField("type", v)}
                        options={TYPE_OPTIONS}
                      />
                    </Field>
                  </div>
                  <Field label="Date">
                    <DateInput
                      value={form.date}
                      onChange={(v) => setField("date", v)}
                    />
                  </Field>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                    <Field label="Start time">
                      <TimeInput
                        value={form.start_time}
                        onChange={(v) => setField("start_time", v)}
                      />
                    </Field>
                    <span className="pb-1 text-[12px] text-muted-foreground">
                      to
                    </span>
                    <Field label="End time">
                      <TimeInput
                        value={form.end_time}
                        onChange={(v) => setField("end_time", v)}
                      />
                    </Field>
                  </div>
                  <Field label="Teacher">
                    <Select
                      value={form.teacherID}
                      onChange={(v) => setField("teacherID", v)}
                      options={teacherOptions}
                    />
                  </Field>
                  {isGroupClass ? (
                    <p className="text-[11px] text-muted-foreground">
                      Manage the student roster from the appointment view
                      (close editing to add/remove students).
                    </p>
                  ) : (
                    <Field label="Customer">
                      <Select
                        value={form.customerID}
                        onChange={(v) => setField("customerID", v)}
                        options={customerOptions}
                      />
                    </Field>
                  )}
                  {fundingEditable && (
                    <Field label="Package / Membership">
                      {fundingOptions === null ? (
                        <p className="text-[11px] text-muted-foreground animate-pulse">
                          Loading…
                        </p>
                      ) : fundingOptions.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          {isUnallocated(event)
                            ? "Unallocated — no active package covers this lesson yet."
                            : "No package or membership can be selected for this lesson."}
                        </p>
                      ) : (
                        <>
                          <Select
                            value={fundingChoice}
                            onChange={setFundingChoice}
                            options={fundingOptions.map((t) => ({
                              value: fundingKey(t),
                              label: t.current ? `${t.label} (current)` : t.label,
                            }))}
                          />
                          {(() => {
                            const chosen = fundingOptions.find(
                              (t) => fundingKey(t) === fundingChoice,
                            );
                            if (!fundingChoice || chosen?.current) return null;
                            return (
                              <p className="mt-1 text-[10px] text-warning leading-relaxed">
                                Saving moves this lesson onto that program: a
                                session is deducted from it and returned to the
                                one funding it now.
                              </p>
                            );
                          })()}
                        </>
                      )}
                    </Field>
                  )}
                  <Field label="Notes">
                    <textarea
                      rows={3}
                      value={form.notes}
                      onChange={(e) => setField("notes", e.target.value)}
                      className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary"
                    />
                  </Field>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Date">
                      <ReadValue>
                        {formatDisplayDate(event.startDateTime)}
                      </ReadValue>
                    </Field>
                    <Field label="Type">
                      <ReadValue>
                        {event.type
                          ? event.type.charAt(0).toUpperCase() +
                            event.type.slice(1)
                          : "—"}
                      </ReadValue>
                    </Field>
                    <Field label="Start">
                      <ReadValue>
                        {formatDisplayTime(event.startDateTime, studioTz)}
                      </ReadValue>
                    </Field>
                    <Field label="End">
                      <ReadValue>
                        {formatDisplayTime(event.endDateTime, studioTz)}
                      </ReadValue>
                    </Field>
                  </div>

                  {/* Service info */}
                  {event.calendarServiceID && (
                    <div>
                      <Label>Service</Label>
                      <div className="mt-1 rounded-lg border border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-foreground truncate">
                            {event.calendarServiceID.serviceName}
                          </p>
                          {event.calendarServiceID.serviceCode && (
                            <p className="text-[10px] text-muted-foreground">
                              {event.calendarServiceID.serviceCode}
                            </p>
                          )}
                        </div>
                        {event.calendarServiceID.isChargeable &&
                          event.calendarServiceID.price > 0 && (
                            <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                              $
                              {Number(event.calendarServiceID.price).toFixed(2)}{" "}
                              / session
                            </span>
                          )}
                      </div>
                      {/* Billing status */}
                      {event.calendarServiceID.isChargeable && (
                        <div className="mt-1.5 flex items-center gap-1.5 px-0.5">
                          {event.chargeApplied ? (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />
                              <span className="text-[11px] text-success font-medium">
                                {event.chargeMethod === "package" &&
                                  event.packageBillingType !==
                                    "pay_per_session" &&
                                  "Paid · Package"}
                                {event.chargeMethod === "package" &&
                                  event.packageBillingType ===
                                    "pay_per_session" &&
                                  "Paid · Per session"}
                                {event.chargeMethod === "membership" &&
                                  "Covered · Membership"}
                                {event.chargeMethod === "credits" &&
                                  `$${Number(event.calendarServiceID.price).toFixed(2)} deducted from credits`}
                                {event.chargeMethod === "mixed" &&
                                  "Charged via package + credits"}
                                {event.chargeMethod === "none" && "Charged"}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                              <span className="text-[11px] text-muted-foreground">
                                Not charged (refunded or waived)
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Teacher details */}
                  <div>
                    <Label>Teacher</Label>
                    {!teacherDetail ? (
                      <p className="text-[13px] text-muted-foreground">—</p>
                    ) : (
                      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-1.5 mt-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="h-7 w-7 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                            {(teacherDetail.name || "?")
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-foreground truncate">
                              {teacherDetail.name}
                            </p>
                            {teacherDetail.specialties?.length > 0 && (
                              <p className="text-[10px] text-muted-foreground truncate">
                                {teacherDetail.specialties.join(", ")}
                              </p>
                            )}
                          </div>
                        </div>
                        {teacherDetail.email && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {teacherDetail.email}
                          </p>
                        )}
                        {teacherDetail.phoneNumber && (
                          <p className="text-[11px] text-muted-foreground">
                            {teacherDetail.phoneNumber}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Customer details */}
                  {event.type === "lesson" ? (
                    <GroupStudentRoster
                      eventId={event._id}
                      serviceCode={event.calendarServiceID?.serviceCode}
                      servicePrice={event.calendarServiceID?.price}
                      onRosterChanged={onRosterChanged}
                      onSelectStudent={(id, name) => {
                        setSelectedStudentId(id);
                        setSelectedStudentName(name);
                      }}
                    />
                  ) : (
                    <div>
                      <Label>
                        Customer{customerDetails.length !== 1 ? "s" : ""}
                      </Label>
                      {customerDetails.length === 0 ? (
                        <p className="text-[13px] text-muted-foreground">—</p>
                      ) : (
                        <div className="space-y-2 mt-1">
                          {customerDetails.map((c) => (
                            <div
                              key={c._id}
                              className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div
                                  className="flex items-center gap-2 min-w-0 cursor-pointer group"
                                  onClick={() => {
                                    setSelectedStudentId(String(c._id));
                                    setSelectedStudentName(c.name || "Student");
                                  }}
                                >
                                  <span className="h-7 w-7 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                                    {(c.name || "?").charAt(0).toUpperCase()}
                                  </span>
                                  <span className="text-[13px] font-semibold text-foreground truncate group-hover:text-primary group-hover:underline">
                                    {c.name || "—"}
                                  </span>
                                </div>
                                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                  ${Number(c.credits ?? 0).toFixed(2)}
                                </span>
                              </div>
                              {c.email && (
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {c.email}
                                </p>
                              )}
                              {c.phoneNumber && (
                                <p className="text-[11px] text-muted-foreground">
                                  {c.phoneNumber}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {event.notes && (
                    <Field label="Notes">
                      <p className="text-[12px] text-foreground whitespace-pre-wrap">
                        {event.notes}
                      </p>
                    </Field>
                  )}

                  {event.payment?.collected && (
                    <div className="rounded-lg border border-success/40 bg-success/5 px-3 py-2 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-semibold text-success">
                          Payment Collected
                        </p>
                        {event.payment.method && (
                          <p className="text-[10px] text-muted-foreground capitalize">
                            {event.payment.method}
                          </p>
                        )}
                      </div>
                      {event.payment.amount != null && (
                        <span className="text-[14px] font-bold text-success">
                          ${Number(event.payment.amount).toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}

              {error && (
                <div className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — hidden when viewing mini student panel */}
        {!selectedStudentId && (
          <div className="border-t border-border p-4 sm:p-5 space-y-2 shrink-0">
            {isEditing ? (
              <div className="space-y-2">
                {isRecurring && (
                  <div className="flex rounded-lg border border-border overflow-hidden text-[11px] font-medium">
                    <button
                      type="button"
                      onClick={() => setUpdateScope("this")}
                      className={`flex-1 py-1.5 transition-colors ${updateScope === "this" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
                    >
                      This event only
                    </button>
                    <button
                      type="button"
                      onClick={() => setUpdateScope("all")}
                      className={`flex-1 py-1.5 transition-colors ${updateScope === "all" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
                    >
                      All in series
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setError(null);
                    }}
                    className="h-9 rounded-lg border border-border bg-background text-[12px] font-semibold text-foreground hover:bg-muted/40"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={handleUpdate}
                    disabled={isSaving}
                    className="h-9 rounded-lg bg-brand text-[12px] font-semibold text-brand-foreground hover:bg-brand-dark disabled:opacity-60"
                  >
                    {isSaving ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Quick record-payment button — hidden for pay_per_session (auto-charged at booking) */}

                {/* Unallocated lesson — nothing has paid for this yet */}
                {isUnallocated(event) && (
                  <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-warning">
                          Not allocated to a package
                        </p>
                        <p className="text-[11px] text-warning/90 leading-relaxed mt-0.5">
                          This lesson isn&apos;t charged to anything. The next
                          eligible package the student buys will claim it
                          automatically, or you can allocate it now.
                        </p>
                      </div>
                    </div>

                    {!allocating ? (
                      <button
                        type="button"
                        onClick={openAllocation}
                        disabled={isSaving}
                        className="h-8 px-3 rounded-lg bg-warning text-[11px] font-semibold text-warning-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        Allocate to a package
                      </button>
                    ) : allocationTargets === null ? (
                      <p className="text-[11px] text-muted-foreground">
                        Loading packages…
                      </p>
                    ) : allocationTargets.length === 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-muted-foreground">
                          No active package can cover this lesson yet.
                        </p>
                        <button
                          type="button"
                          onClick={() => setAllocating(false)}
                          className="text-[11px] font-medium text-brand hover:underline"
                        >
                          Close
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {allocationTargets.map((t) => (
                          <button
                            key={
                              t.enrollmentID ||
                              t.customerPackageID ||
                              t.customerMembershipID
                            }
                            type="button"
                            onClick={() => allocateTo(t)}
                            disabled={isSaving}
                            className="w-full flex items-center justify-between rounded-lg border border-border bg-background px-2.5 py-2 text-left hover:bg-muted/40 disabled:opacity-50 transition-colors"
                          >
                            <span className="text-[11px] font-medium truncate">
                              {t.label}
                            </span>
                          </button>
                        ))}
                        {/* allocateTo() sets `error` on failure, but the
                            component's only other render of it lives in the
                            scrollable body above, out of view of this footer
                            block — surface it here too so a rejected
                            allocation (wrong customer, service mismatch, no
                            sessions left, etc.) doesn't look like a no-op. */}
                        {error && (
                          <p className="text-[11px] text-destructive">{error}</p>
                        )}
                        <button
                          type="button"
                          onClick={() => setAllocating(false)}
                          className="text-[11px] font-medium text-muted-foreground hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Rebooking a lesson no program can fund any more */}
                {rebookPrompt && (
                  <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                      <p className="text-[11px] text-warning leading-relaxed">
                        {rebookPrompt.message}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={confirmRebookUnallocated}
                        disabled={isSaving}
                        className="h-8 px-3 rounded-lg bg-warning text-[11px] font-semibold text-warning-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        Rebook unallocated
                      </button>
                      <button
                        type="button"
                        onClick={() => setRebookPrompt(null)}
                        className="h-8 px-3 rounded-lg border border-border bg-background text-[11px] font-semibold text-foreground hover:bg-muted/40 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Completing an unallocated lesson writes it off as a comp */}
                {overridePrompt && (
                  <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-[12px] font-semibold text-destructive">
                      Complete without a package?
                    </p>
                    <p className="text-[11px] text-destructive/90 leading-relaxed">
                      No package or membership paid for this lesson. Completing
                      it now records it as a comped session — no sessions are
                      deducted and no revenue is recorded.
                    </p>
                    <input
                      type="text"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="Reason (optional)"
                      className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-[11px] text-foreground placeholder:text-muted-foreground"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={confirmOverride}
                        disabled={isSaving}
                        className="h-8 px-3 rounded-lg bg-destructive text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        Complete as comp
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOverridePrompt(null);
                          setOverrideReason("");
                        }}
                        className="h-8 px-3 rounded-lg border border-border bg-background text-[11px] font-semibold text-foreground hover:bg-muted/40 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Quick status actions — only shown when event is still scheduled */}
                {event.effectiveStatus === "scheduled" ||
                event.status === "scheduled" ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Mark as
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {/* Unallocated lessons are never auto-completed, so they
                          need an explicit way out — either allocate above, or
                          complete as a comp if permitted. */}
                      {isUnallocated(event) && (
                        <button
                          type="button"
                          onClick={() => handleQuickStatus("completed")}
                          disabled={isSaving}
                          className="col-span-2 h-9 rounded-lg border border-success/30 bg-background text-[11px] font-semibold text-success hover:bg-success/10 disabled:opacity-50 transition-colors"
                        >
                          Completed
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleQuickStatus("cancelled_no_charge")}
                        disabled={isSaving}
                        className="h-9 rounded-lg border border-border bg-background text-[11px] font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                      >
                        Cancel – No Charge
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickStatus("cancelled_charged")}
                        disabled={isSaving}
                        className="h-9 rounded-lg border border-destructive/20 bg-background text-[11px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                      >
                        Cancel – Charged
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickStatus("no_show_no_charge")}
                        disabled={isSaving}
                        className="h-9 rounded-lg border border-warning/40 dark:border-warning/40 bg-background text-[11px] font-semibold text-warning hover:bg-warning dark:hover:bg-warning/40 disabled:opacity-50 transition-colors"
                      >
                        No Show – No Charge
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickStatus("no_show_charged")}
                        disabled={isSaving}
                        className="h-9 rounded-lg border border-warning/40 dark:border-warning/40 bg-background text-[11px] font-semibold text-warning hover:bg-warning dark:hover:bg-warning/40 disabled:opacity-50 transition-colors"
                      >
                        No Show – Charged
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* Delete */}
                {hasPermission("calendar", "bookings", "delete") && (
                  confirmDelete ? (
                    <div className="space-y-2">
                      {isRecurring && (
                        <div className="flex rounded-lg border border-border overflow-hidden text-[11px] font-medium">
                          <button
                            type="button"
                            onClick={() => setDeleteScope("this")}
                            className={`flex-1 py-1.5 transition-colors ${deleteScope === "this" ? "bg-destructive text-white" : "text-muted-foreground hover:bg-muted/40"}`}
                          >
                            This event only
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteScope("all")}
                            className={`flex-1 py-1.5 transition-colors ${deleteScope === "all" ? "bg-destructive text-white" : "text-muted-foreground hover:bg-muted/40"}`}
                          >
                            All in series
                          </button>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          className="flex-1 h-9 rounded-lg border border-border bg-background text-[12px] font-semibold text-foreground hover:bg-muted/40"
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          onClick={handleDelete}
                          disabled={isDeleting}
                          className="flex-1 h-9 rounded-lg bg-destructive text-[12px] font-semibold text-white hover:bg-destructive/90 disabled:opacity-60"
                        >
                          {isDeleting ? "Deleting…" : "Confirm Delete"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="w-full h-9 rounded-lg border border-destructive/40 text-[12px] font-semibold text-destructive hover:bg-destructive/10 flex items-center justify-center gap-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Permanently
                    </button>
                  )
                )}
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
