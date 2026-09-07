"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Clock,
  Plus,
  RefreshCw,
  Search,
  User,
  Users,
} from "lucide-react";
import api from "@/lib/api";
import { getEffectiveBranch } from "@/lib/auth";
import { studioWallTimeToUtcISO } from "@/lib/studio-time";
import { validateRecurrence } from "@/lib/recurrence";
import { toStudioLocalDate } from "@/lib/studioLocalDate";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import MultiSelectCheckboxDropdown from "@/components/shared/MultiSelectCheckboxDropdown";
import NewEnrollmentPackageInline from "@/app/calendar/components/NewEnrollmentPackageInline";
import LocationSelector from "@/components/shared/LocationSelector";
import SearchableSelect from "@/components/ui/searchable-select";
// A session payment lands on CalendarEvent.payment.method, whose enum has no wallet.
import { PURCHASE_METHODS as PAYMENT_METHODS } from "@/lib/paymentMethods";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bumpHour(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  return `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
}

function addMinutes(timeStr, minutesToAdd) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  const total = h * 60 + m + (Number(minutesToAdd) || 0);
  const clamped = Math.max(0, Math.min(total, 23 * 60 + 59));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/**
 * `/api/calendar` expects `start`/`end`, not `date`. Bounds for the studio's
 * calendar day: `startISO`/`endISO` are the real UTC instants to query on, while
 * `dayStartMs`/`dayEndExclusiveMs` live in the "studio wall-clock as browser
 * local" space that `toStudioLocalDate` maps event instants into — so the two
 * are only comparable after that conversion. Without `tz` this is browser-local,
 * the pre-timezone behaviour.
 */
function localCalendarDayQueryRange(dateStr, tz) {
  const [y, mo, d] = String(dateStr).split("-").map(Number);
  if (!y || !mo || !d) return null;
  const dayStart = new Date(y, mo - 1, d, 0, 0, 0, 0);
  const dayEndExclusive = dayStart.getTime() + 86400000;
  const startISO =
    studioWallTimeToUtcISO(dateStr, "00:00", tz) || dayStart.toISOString();
  const endISO =
    studioWallTimeToUtcISO(dateStr, "23:59", tz) ||
    new Date(y, mo - 1, d, 23, 59, 59, 999).toISOString();
  return {
    startISO,
    endISO,
    dayStartMs: dayStart.getTime(),
    dayEndExclusiveMs: dayEndExclusive,
  };
}

/**
 * Clip booking [evStart,evEnd) to this studio day → minutes from midnight
 * [start,end). `evStart`/`evEnd` must already be mapped into studio wall-clock
 * space (via `toStudioLocalDate`) so their getters line up with `dayStartMs`.
 */
function clipIntervalToLocalDay(evStart, evEnd, dayStartMs, dayEndExclusiveMs) {
  const s = Math.max(evStart.getTime(), dayStartMs);
  const e = Math.min(evEnd.getTime(), dayEndExclusiveMs);
  if (e <= s) return null;
  return {
    start: Math.max(0, Math.floor((s - dayStartMs) / 60000)),
    end: Math.min(24 * 60, Math.ceil((e - dayStartMs) / 60000)),
  };
}

/** Cancelled lessons free the slot for new bookings */
function statusBlocksAvailability(status) {
  if (status === "cancelled_no_charge" || status === "cancelled_charged") return false;
  return true;
}

function mergeMinuteIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start < prev.end) prev.end = Math.max(prev.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

function ordinalLabel(n) {
  return ["1st", "2nd", "3rd"][n - 1] ?? `${n}th`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { key: "Appointment", label: "Appointment", icon: User },
  { key: "Group Class", label: "Group Class", icon: Users },
  { key: "To Do", label: "To Do", icon: CalendarDays },
];

const TAB_TYPE_MAP = {
  Appointment: "private",
  "Group Class": "lesson",
  "To Do": "event",
};

const TAB_SAVE_LABEL = {
  Appointment: "Book Appointment",
  "Group Class": "Create Group Event",
  "To Do": "Save To Do",
};

const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Su" },
  { value: 1, label: "Mo" },
  { value: 2, label: "Tu" },
  { value: 3, label: "We" },
  { value: 4, label: "Th" },
  { value: 5, label: "Fr" },
  { value: 6, label: "Sa" },
];

const MONTHLY_WEEK_OPTIONS = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: -1, label: "Last" },
];

const EMPTY_FORM = {
  lesson_id: "",
  todo_id: "",
  service_id: "",
  location_id: "",
  instructor_id: "",
  instructor_ids: [],
  customer_id: "",
  customer_ids: [],
  enrollment_id: "",
  customer_membership_id: "",
  date: "",
  start_time: "",
  end_time: "",
  selected_time_slots: [],
  public_note: "",
  internal_note: "",
  title: "",
  recurrence_enabled: false,
  recurrence_frequency: "weekly",
  recurrence_end_date: "",
  recurrence_days_of_week: [],
  recurrence_monthly_weekday: null,
  recurrence_monthly_weeks: [],
  event_color: "",
  payment_collected: false,
  payment_amount: "",
  payment_method: "",
  session_payment_method: "",
  group_sell_package: false,
  group_package_id: "",
  member_ids: [],
  group_member_ids: {},
};

// ─── Primitive UI ─────────────────────────────────────────────────────────────

function FieldLabel({ children }) {
  return (
    <label className="block mb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
      {children}
    </label>
  );
}

function SectionDivider({ label }) {
  return (
    <div className="flex items-center gap-2 pt-1 pb-0.5">
      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}

function StyledInput({ value, onChange, placeholder, type = "text" }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/50"
    />
  );
}

function StyledSelect({
  value,
  onChange,
  options = [],
  placeholder,
  disabled,
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[12px] text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="">{placeholder}</option>
        {options.map((opt, i) => (
          <option key={opt.value != null ? opt.value : i} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function StyledTextArea({ value, onChange, placeholder, rows = 2 }) {
  return (
    <textarea
      rows={rows}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/50"
    />
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange?.(!checked)}
      className={[
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
        checked ? "bg-brand" : "bg-muted",
      ].join(" ")}
    >
      <span
        className={[
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-card shadow transform transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

// ─── MultiSelect ──────────────────────────────────────────────────────────────

function MultiSelect({ values = [], onChange, options = [], placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const selected = new Set(values);
  const available = options.filter((o) => !selected.has(o.value));
  const selectedOptions = options.filter((o) => selected.has(o.value));
  const filtered = query.trim()
    ? available.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : available;

  useEffect(() => {
    if (!open) { setQuery(""); return; }
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} className="relative rounded-lg border border-border bg-background focus-within:border-primary transition-colors">
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
          {selectedOptions.map((opt) => (
            <span
              key={opt.value}
              className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand"
            >
              {opt.label}
              <button
                type="button"
                onClick={() => onChange?.(values.filter((v) => v !== opt.value))}
                className="ml-0.5 leading-none hover:text-brand/70"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-9 w-full flex items-center justify-between px-3 pr-8 text-[12px] outline-none relative"
      >
        <span className="text-muted-foreground/50">
          {available.length === 0 ? "All selected" : placeholder}
        </span>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-background shadow-lg overflow-hidden">
          <div className="p-1.5 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-7 w-full rounded-md border border-border bg-muted/30 px-2.5 text-[11px] text-foreground outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">
                {available.length === 0 ? "All selected" : "No results"}
              </p>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange?.([...values, opt.value]); setQuery(""); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-foreground hover:bg-muted/50 transition-colors"
                >
                  {opt.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New student inline form ──────────────────────────────────────────────────

function NewStudentInlineForm({ onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [locationID, setLocationID] = useState(() => {
    const branch = getEffectiveBranch();
    return branch ? [String(branch)] : [];
  });
  const [error, setError] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate() {
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (!Array.isArray(locationID) || locationID.length === 0) {
      setError("Please select at least one location.");
      return;
    }
    setIsCreating(true);
    setError(null);
    const result = await onCreate({
      name: name.trim(),
      email: email.trim(),
      phoneNumber: phone.trim() || undefined,
      locationID,
    });
    if (!result) setError("Failed to create student.");
    setIsCreating(false);
  }

  return (
    <div className="mt-2 rounded-xl border border-brand/30 bg-brand/5 p-3 space-y-2">
      <p className="text-[11px] font-semibold text-brand">New Student</p>
      <StyledInput placeholder="Full name *" value={name} onChange={setName} />
      <StyledInput
        placeholder="Email address *"
        value={email}
        onChange={setEmail}
        type="email"
      />
      <StyledInput
        placeholder="Phone (optional)"
        value={phone}
        onChange={setPhone}
        type="tel"
      />
      <div>
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">Location *</p>
        <LocationSelector
          value={locationID}
          onChange={setLocationID}
          multiple
          showAllOption={false}
          placeholder="Select location(s)…"
        />
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 h-8 rounded-lg border border-border bg-background text-[11px] font-semibold text-foreground hover:bg-muted/40 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={isCreating}
          className="flex-1 h-8 rounded-lg bg-brand text-[11px] font-semibold text-brand-foreground hover:bg-brand-dark disabled:opacity-60 transition-colors"
        >
          {isCreating ? "Creating…" : "Create & Select"}
        </button>
      </div>
    </div>
  );
}

// ─── Unallocated booking: service picker with no package behind it ───────────
//
// Shown when the student has nothing left to book against. The lesson is still
// created as a normal lesson, but it deducts from no balance and stays
// unallocated until they buy a package — which claims it automatically. Staff
// still have to pick the service, because that is what decides which package
// can later fund it.
function UnallocatedServicePicker({
  reason,
  allServices,
  selectedServiceId,
  onServiceSelect,
  onOpenEnrollmentWizard,
}) {
  const [serviceQuery, setServiceQuery] = useState("");

  const showSearch = allServices.length > 5;
  const filteredServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    if (!q) return allServices;
    return allServices.filter((svc) =>
      `${svc.serviceName || ""} ${svc.serviceCode || ""}`.toLowerCase().includes(q),
    );
  }, [allServices, serviceQuery]);

  if (allServices.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-3 text-center">
        <p className="text-[11px] text-muted-foreground">
          No services available for this booking type.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 space-y-2.5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
        <p className="text-[11px] text-warning leading-relaxed">
          {reason} You can still book ahead — pick a service below. Nothing is
          charged now, and the next package purchased will claim these lessons
          automatically.
        </p>
      </div>

      <div className="space-y-1">
        <FieldLabel>Service</FieldLabel>
        {showSearch && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={serviceQuery}
              onChange={(e) => setServiceQuery(e.target.value)}
              placeholder="Search services…"
              className="h-8 w-full rounded-lg border border-border bg-background pl-7 pr-2 text-[11px] outline-none focus:border-brand"
            />
          </div>
        )}
        <div className="space-y-1.5">
          {filteredServices.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border py-4 text-center text-[11px] text-muted-foreground">
              No services match “{serviceQuery.trim()}”.
            </p>
          ) : (
            filteredServices.map((svc) => {
            const isSelected = selectedServiceId === String(svc._id);
            return (
              <div
                key={String(svc._id)}
                onClick={() => onServiceSelect(String(svc._id), svc.color)}
                className={[
                  "flex items-center justify-between rounded-lg px-2.5 py-2 cursor-pointer border transition-colors",
                  isSelected
                    ? "border-brand bg-brand/10"
                    : "border-border bg-background hover:bg-muted/40",
                ].join(" ")}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {svc.color && (
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: svc.color }}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium truncate">
                      {svc.serviceName || svc.serviceCode}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Unallocated — no package charged
                    </p>
                  </div>
                </div>
                {svc.price > 0 && (
                  <span className="text-[11px] font-semibold text-foreground ml-2 shrink-0">
                    ${svc.price.toFixed(2)}
                  </span>
                )}
              </div>
            );
            })
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onOpenEnrollmentWizard?.(true)}
        className="flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
      >
        <Plus className="h-3 w-3" /> Or sell a package now
      </button>
    </div>
  );
}

// ─── Enrollment → Package → Service selector ──────────────────────────────────

function EnrollmentServiceSelector({
  customerId,
  enrollments,
  selectedEnrollmentId,
  onEnrollmentSelect,
  onServiceSelect,
  selectedServiceId,
  allServices,
  onOpenEnrollmentWizard,
}) {
  if (!customerId) return null;

  // An unallocated booking must not carry any package/enrollment selection, or
  // the backend funds the session from that enrollment's credits. Clear the
  // enrollment (and, via onServiceSelect, the membership) before selecting.
  const handleUnallocatedServiceSelect = (serviceId, color) => {
    onEnrollmentSelect("");
    onServiceSelect(serviceId, color);
  };

  const activeEnrollments = enrollments.filter(
    (e) => e.status === "active" && e.package?.status !== "cancelled",
  );

  if (enrollments.length === 0) {
    return (
      <UnallocatedServicePicker
        reason="This student has no enrollments yet."
        allServices={allServices}
        selectedServiceId={selectedServiceId}
        onServiceSelect={handleUnallocatedServiceSelect}
        onOpenEnrollmentWizard={onOpenEnrollmentWizard}
      />
    );
  }

  if (activeEnrollments.length === 0) {
    return (
      <UnallocatedServicePicker
        reason="This student has no active package."
        allServices={allServices}
        selectedServiceId={selectedServiceId}
        onServiceSelect={handleUnallocatedServiceSelect}
        onOpenEnrollmentWizard={onOpenEnrollmentWizard}
      />
    );
  }

  // Enrollments exist but every one of them is out of sessions for the services
  // in this tab — the exact case this feature is for.
  const anySessionsLeft = activeEnrollments.some((e) =>
    (e.package?.services ?? []).some(
      (svc) =>
        svc.sessionsRemaining > 0 &&
        allServices.some((cat) => cat.serviceCode === svc.serviceCode),
    ),
  );
  if (!anySessionsLeft) {
    return (
      <UnallocatedServicePicker
        reason="This student has used every session in their package."
        allServices={allServices}
        selectedServiceId={selectedServiceId}
        onServiceSelect={handleUnallocatedServiceSelect}
        onOpenEnrollmentWizard={onOpenEnrollmentWizard}
      />
    );
  }

  const selectedEnrollment = activeEnrollments.find(
    (e) => String(e._id) === selectedEnrollmentId,
  );
  const cp = selectedEnrollment?.package ?? null; // embedded package
  // `allServices` here is the tab-scoped catalog (private vs group); only list
  // package lines that match those service codes.
  const enrollmentServices =
    cp?.services?.filter(
      (s) =>
        s.sessionsRemaining > 0 &&
        allServices.some((cat) => cat.serviceCode === s.serviceCode),
    ) ?? [];

  // Enrollments with sessions left for a service in this tab, split by whether
  // they are a real package or a services-only sale. When the student has both,
  // each kind gets its own dropdown; otherwise a single one, labelled to match.
  const bookableEnrollments = activeEnrollments.filter(
    (e) =>
      e.package &&
      (e.package.services ?? []).some(
        (s) =>
          s.sessionsRemaining > 0 &&
          allServices.some((cat) => cat.serviceCode === s.serviceCode),
      ),
  );
  const packageEnrollments = bookableEnrollments.filter((e) => e.package.packageRef);
  const serviceEnrollments = bookableEnrollments.filter((e) => !e.package.packageRef);

  const handleEnrollmentChange = (v) => {
    onEnrollmentSelect(v);
    const enr = bookableEnrollments.find((e) => String(e._id) === v);
    const svcs = (enr?.package?.services ?? []).filter(
      (s) => s.sessionsRemaining > 0 && allServices.some((cat) => cat.serviceCode === s.serviceCode),
    );
    if (svcs.length === 1) {
      const info = allServices.find((s) => s.serviceCode === svcs[0].serviceCode);
      if (info) onServiceSelect(String(info._id), svcs[0].color || info.color);
    }
  };

  const packageOptions = packageEnrollments.map((e) => ({
    value: String(e._id),
    label: e.package.packageName || "Unnamed Package",
  }));
  const serviceOptions = serviceEnrollments.map((e) => {
    const svcNames = (e.package.services ?? [])
      .map((s) => s.serviceName || s.serviceCode)
      .filter(Boolean)
      .join(", ");
    return { value: String(e._id), label: e.label || svcNames || "Services" };
  });

  return (
    <div className="space-y-2">
      {packageEnrollments.length > 0 && (
        <div>
          <FieldLabel>Package</FieldLabel>
          <StyledSelect
            value={serviceEnrollments.some((e) => String(e._id) === selectedEnrollmentId) ? "" : selectedEnrollmentId}
            onChange={handleEnrollmentChange}
            options={packageOptions}
            placeholder="Select package…"
          />
        </div>
      )}
      {serviceEnrollments.length > 0 && (
        <div>
          <FieldLabel>Services</FieldLabel>
          <StyledSelect
            value={packageEnrollments.some((e) => String(e._id) === selectedEnrollmentId) ? "" : selectedEnrollmentId}
            onChange={handleEnrollmentChange}
            options={serviceOptions}
            placeholder="Select service…"
          />
        </div>
      )}
      <div>
        <button
          type="button"
          onClick={() => onOpenEnrollmentWizard?.(true)}
          className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
        >
          <Plus className="h-3 w-3" /> Add enrollment
        </button>
      </div>

      {selectedEnrollment && cp && (
        <>

          {/* Services */}
          {enrollmentServices.length === 0 ? (
            <p className="text-[11px] text-muted-foreground px-0.5">
              No sessions remaining in this enrollment.
            </p>
          ) : (
            <div className="space-y-1">
              <FieldLabel>Service</FieldLabel>
              <div className="space-y-1.5">
                {enrollmentServices.map((svc, idx) => {
                  const serviceInfo = allServices.find(
                    (s) => s.serviceCode === svc.serviceCode,
                  );
                  const serviceColor = svc.color || serviceInfo?.color;
                  const isSelected =
                    selectedServiceId === String(serviceInfo?._id);
                  return (
                    <div
                      key={idx}
                      onClick={() =>
                        serviceInfo &&
                        onServiceSelect(String(serviceInfo._id), serviceColor)
                      }
                      className={[
                        "flex items-center justify-between rounded-lg px-2.5 py-2 cursor-pointer border transition-colors",
                        isSelected
                          ? "border-brand bg-brand/10"
                          : "border-border bg-background hover:bg-muted/40",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {serviceColor && (
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ background: serviceColor }}
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium truncate">
                            {serviceInfo?.serviceName ||
                              svc.serviceName ||
                              svc.serviceCode}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {svc.sessionsRemaining} / {svc.sessionsTotal}{" "}
                            sessions left
                          </p>
                        </div>
                      </div>
                      {serviceInfo?.price > 0 && (
                        <span className="text-[11px] font-semibold text-foreground ml-2 shrink-0">
                          ${serviceInfo.price.toFixed(2)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Membership → Service selector ────────────────────────────────────────────
// Lists each active membership and its services that exist in this tab's catalog.
// Selecting a line identifies both the membership and the service so the backend
// charges that exact membership — distinguishing two memberships that cover the
// same service. Shown alongside the package selector so either can be chosen.

function MembershipServiceSelector({
  customerId,
  allServices,
  selectedServiceId,
  selectedMembershipId,
  onSelect,
  onHasMembershipChange,
}) {
  const [memberships, setMemberships] = useState([]);

  useEffect(() => {
    if (!customerId) {
      setMemberships([]);
      onHasMembershipChange?.(false);
      return;
    }
    let cancelled = false;
    api
      .get(`/api/customer-membership/customer/${customerId}?status=active`)
      .then((res) => {
        if (cancelled) return;
        const data =
          res.success && Array.isArray(res.data)
            ? res.data.filter((m) => m.status === "active")
            : [];
        setMemberships(data);
        onHasMembershipChange?.(data.length > 0);
        // Auto-select if there's only one membership with one matching service
        if (data.length === 1) {
          const lines = (data[0].services || []).filter((svc) =>
            allServices.some((cat) => cat.serviceCode === svc.serviceCode),
          );
          if (lines.length === 1) {
            const info = allServices.find((s) => s.serviceCode === lines[0].serviceCode);
            if (info)
              onSelect(String(data[0]._id), String(info._id), lines[0].color || info.color);
          }
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  if (!customerId || memberships.length === 0) return null;

  const selectedMembership = memberships.find(
    (m) => String(m._id) === selectedMembershipId,
  );
  const lines = (selectedMembership?.services ?? []).filter((svc) =>
    allServices.some((cat) => cat.serviceCode === svc.serviceCode),
  );

  return (
    <div className="space-y-2">
      <div>
        <FieldLabel>Memberships</FieldLabel>
        <StyledSelect
          value={selectedMembershipId}
          onChange={(v) => {
            const m = memberships.find((x) => String(x._id) === v);
            const svcs = (m?.services ?? []).filter((svc) =>
              allServices.some((cat) => cat.serviceCode === svc.serviceCode),
            );
            if (svcs.length === 1) {
              const info = allServices.find(
                (s) => s.serviceCode === svcs[0].serviceCode,
              );
              onSelect(
                v,
                info ? String(info._id) : "",
                svcs[0].color || info?.color,
              );
            } else {
              onSelect(v, "", "");
            }
          }}
          options={memberships.map((m) => ({
            value: String(m._id),
            label: m.membershipName || "Membership",
          }))}
          placeholder="Select membership…"
        />
      </div>

      {selectedMembership &&
        (lines.length === 0 ? (
          <p className="text-[11px] text-muted-foreground px-0.5">
            No covered services for this booking type.
          </p>
        ) : (
          <div className="space-y-1">
            <FieldLabel>Service</FieldLabel>
            <div className="space-y-1.5">
              {lines.map((svc, idx) => {
                const serviceInfo = allServices.find(
                  (s) => s.serviceCode === svc.serviceCode,
                );
                const serviceColor = svc.color || serviceInfo?.color;
                const isSelected =
                  selectedServiceId === String(serviceInfo?._id);
                const isUnlimited = svc.accessType === "unlimited";
                const noSessionsLeft =
                  !isUnlimited && (svc.sessionsRemaining ?? 0) <= 0;
                return (
                  <div
                    key={idx}
                    onClick={() =>
                      serviceInfo &&
                      onSelect(
                        String(selectedMembership._id),
                        String(serviceInfo._id),
                        serviceColor,
                      )
                    }
                    className={[
                      "flex items-center justify-between rounded-lg px-2.5 py-2 cursor-pointer border transition-colors",
                      isSelected
                        ? "border-brand bg-brand/10"
                        : "border-border bg-background hover:bg-muted/40",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {serviceColor && (
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ background: serviceColor }}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium truncate">
                          {serviceInfo?.serviceName ||
                            svc.serviceName ||
                            svc.serviceCode}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {isUnlimited
                            ? "Unlimited"
                            : noSessionsLeft
                              ? "No sessions remaining"
                              : `${svc.sessionsRemaining} / ${svc.sessionsTotal} sessions left`}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

// ─── Member picker (shown when a selected customer has members) ───────────────

function MemberPicker({ members, selectedIds, onChange, label = "Attending members" }) {
  if (!members || members.length === 0) return null;
  const toggle = (id) => {
    const set = new Set(selectedIds);
    set.has(id) ? set.delete(id) : set.add(id);
    onChange([...set]);
  };
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-3 py-2.5 space-y-1.5">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => {
          const selected = selectedIds.includes(String(m._id));
          return (
            <button
              key={m._id}
              type="button"
              onClick={() => toggle(String(m._id))}
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
                <span className="opacity-60 capitalize">· {m.relationship}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── WHO section ──────────────────────────────────────────────────────────────

function WhoSection({
  form,
  setField,
  instructorOptions,
  customerOptions,
  rawCustomers,
  onNewCustomer,
  onOpenEnrollmentWizard,
  enrollments,
  allServices,
}) {
  const selectedCustomer = rawCustomers?.find((c) => String(c._id) === form.customer_id);
  const selectedMembers = selectedCustomer?.members || [];
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="space-y-3">
      <SectionDivider label="Who" />

      <div>
        <FieldLabel>Student</FieldLabel>
        <SearchableSelect
          value={form.customer_id}
          onChange={(v) => {
            setField("customer_id", v);
            setField("member_ids", []);
            onOpenEnrollmentWizard?.(false);
            setField("enrollment_id", "");
            setField("customer_membership_id", "");
            setField("service_id", "");
            setField("event_color", "");
          }}
          options={customerOptions}
          placeholder="Select student…"
        />
        {showNew ? (
          <NewStudentInlineForm
            onCreate={async (data) => {
              const id = await onNewCustomer(data);
              if (id) {
                setField("customer_id", id);
                setShowNew(false);
              }
              return id;
            }}
            onCancel={() => setShowNew(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
          >
            <Plus className="h-3 w-3" /> Add new student
          </button>
        )}
      </div>

      {selectedMembers.length > 0 && (
        <MemberPicker
          members={selectedMembers}
          selectedIds={form.member_ids}
          onChange={(ids) => setField("member_ids", ids)}
        />
      )}

      {form.customer_id && (
        <MembershipServiceSelector
          customerId={form.customer_id}
          allServices={allServices}
          selectedServiceId={form.service_id}
          selectedMembershipId={form.customer_membership_id}
          onSelect={(membershipId, serviceId, color) => {
            setField("enrollment_id", "");
            setField("session_payment_method", "");
            setField("customer_membership_id", membershipId);
            setField("service_id", serviceId);
            if (color) setField("event_color", color);
          }}
        />
      )}

      {form.customer_id && (
        <EnrollmentServiceSelector
          customerId={form.customer_id}
          enrollments={enrollments[form.customer_id] || []}
          selectedEnrollmentId={form.enrollment_id}
          onEnrollmentSelect={(v) => {
            setField("customer_membership_id", "");
            setField("enrollment_id", v);
            setField("service_id", "");
            setField("session_payment_method", "");
          }}
          onServiceSelect={(serviceId, color) => {
            setField("customer_membership_id", "");
            setField("service_id", serviceId);
            if (color) setField("event_color", color);
          }}
          selectedServiceId={form.service_id}
          allServices={allServices}
          onOpenEnrollmentWizard={onOpenEnrollmentWizard}
        />
      )}

      <div>
        <FieldLabel>Teacher</FieldLabel>
        <SearchableSelect
          value={form.instructor_id}
          onChange={(v) => setField("instructor_id", v)}
          options={instructorOptions}
          placeholder="Select teacher…"
        />
      </div>
    </div>
  );
}

// ─── WHO section (group — multi-student) ──────────────────────────────────────

function GroupWhoSection({
  form,
  setField,
  instructorOptions,
  customerOptions,
  packageOptions,
  onNewCustomer,
}) {
  const [showNew, setShowNew] = useState(false);
  return (
    <div className="space-y-3">
      <SectionDivider label="Who" />
      <div>
        <FieldLabel>Teacher</FieldLabel>
        <SearchableSelect
          value={form.instructor_id}
          onChange={(v) => setField("instructor_id", v)}
          options={instructorOptions}
          placeholder="Select teacher…"
        />
      </div>
      <div>
        <FieldLabel>Students</FieldLabel>
        <MultiSelect
          values={form.customer_ids}
          onChange={(v) => setField("customer_ids", v)}
          options={customerOptions}
          placeholder="Select students…"
        />
        {showNew ? (
          <NewStudentInlineForm
            onCreate={async (data) => {
              const id = await onNewCustomer(data);
              if (id) {
                setField("customer_ids", [...form.customer_ids, id]);
                setShowNew(false);
              }
              return id;
            }}
            onCancel={() => setShowNew(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
          >
            <Plus className="h-3 w-3" /> Add new student
          </button>
        )}
      </div>
      {form.customer_ids.length > 0 && (
        <div
          className={[
            "rounded-xl border px-3 py-2.5 transition-colors",
            form.group_sell_package
              ? "border-success/20 bg-success/5"
              : "border-border bg-muted/20",
          ].join(" ")}
        >
          <div className="flex items-center justify-between">
            <div>
              <p
                className={`text-[12px] font-semibold ${form.group_sell_package ? "text-success" : "text-foreground"}`}
              >
                {form.group_sell_package
                  ? "Selling package at booking"
                  : "Sell package at booking"}
              </p>
              {!form.group_sell_package && (
                <p className="text-[10px] text-muted-foreground">
                  Sell to all {form.customer_ids.length} selected student
                  {form.customer_ids.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
            <Toggle
              checked={form.group_sell_package}
              onChange={(v) => setField("group_sell_package", v)}
            />
          </div>
          {form.group_sell_package && (
            <div className="mt-2.5">
              <FieldLabel>Package to Sell</FieldLabel>
              <StyledSelect
                value={form.group_package_id}
                onChange={(v) => setField("group_package_id", v)}
                options={packageOptions}
                placeholder="Select package to sell…"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Scheduling block (for Group Class) ───────────────────────────────────────

function SchedulingBlock({ form, setField, schedulingCodeOptions }) {
  return (
    <div className="space-y-3">
      <SectionDivider label="Details" />
      <div>
        <FieldLabel>Service</FieldLabel>
        <StyledSelect
          value={form.service_id}
          onChange={(v) => setField("service_id", v)}
          options={schedulingCodeOptions}
          placeholder="Select service…"
        />
      </div>
    </div>
  );
}

// ─── Group Class details block ─────────────────────────────────────────────────

function GroupDetailsBlock({
  form,
  setField,
  lessonOptions,
  lessonMap,
  allServices,
  schedulingCodeOptions,
}) {
  function handleLessonChange(id) {
    const lesson = lessonMap[id];
    setField("lesson_id", id);
    if (lesson?.calendarServiceID) {
      const svcId =
        typeof lesson.calendarServiceID === "object"
          ? String(lesson.calendarServiceID._id)
          : String(lesson.calendarServiceID);
      setField("service_id", svcId);
    }
    if (lesson?.name) setField("title", lesson.name);
    if (lesson?.color) setField("event_color", lesson.color);
    if (lesson?.duration && form.start_time)
      setField("end_time", addMinutes(form.start_time, lesson.duration));
  }

  const selectedLesson = form.lesson_id ? lessonMap[form.lesson_id] : null;

  return (
    <div className="space-y-3">
      <SectionDivider label="Class" />
      <div>
        <FieldLabel>Program</FieldLabel>
        <StyledSelect
          value={form.lesson_id}
          onChange={handleLessonChange}
          options={lessonOptions}
          placeholder="Select class / program…"
        />
        {selectedLesson && (
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
            {selectedLesson.color && (
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ background: selectedLesson.color }}
              />
            )}
            <span className="text-[11px] text-foreground font-medium truncate">
              {selectedLesson.name}
            </span>
            {selectedLesson.duration && (
              <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                {selectedLesson.duration} min
              </span>
            )}
          </div>
        )}
      </div>
      <div>
        <FieldLabel>Billing Service</FieldLabel>
        <StyledSelect
          value={form.service_id}
          onChange={(v) => setField("service_id", v)}
          options={schedulingCodeOptions}
          placeholder="Select service…"
        />
      </div>
    </div>
  );
}

// ─── Teacher availability picker ──────────────────────────────────────────────

function formatTime12h(time24) {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Same rhythm as the day grid: slotAlign + n × step, skipping overlaps by
 * resuming at the end of the blocking booking.
 */
function enumerateAvailabilitySlotStarts(
  slotAlignMins,
  slotStepMins,
  dayEndMin,
  busyIntervals = [],
  bookingDurMins,
) {
  const step = Math.max(15, Number(slotStepMins) || 30);
  const bookingDur = Math.max(
    15,
    Number(bookingDurMins) > 0 ? Number(bookingDurMins) : step,
  );
  const windowStart = Math.max(0, Number(slotAlignMins) || 0);
  const windowEnd = Math.min(24 * 60, Number(dayEndMin) || 21 * 60);
  const busy = [...busyIntervals].sort((a, b) => a.start - b.start);

  let t = windowStart;
  const starts = [];

  while (t + bookingDur <= windowEnd) {
    const slotEnd = t + bookingDur;
    const conflict = busy.find((b) => t < b.end && slotEnd > b.start);
    if (conflict) {
      if (conflict.end > t) {
        t = conflict.end;
        continue;
      }
    }
    starts.push(t);
    t += step;
  }

  return starts;
}

function AvailabilityPicker({
  instructorId,
  date,
  duration,
  slotStepMins,
  slotAlignMins,
  dayEndMin,
  selectedSlots,
  onToggleSlot,
  studioTz,
}) {
  /** Merged busy intervals for `date`, minutes from studio midnight */
  const [busyIntervalsMin, setBusyIntervalsMin] = useState([]);
  const [blockingEventCount, setBlockingEventCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const range = localCalendarDayQueryRange(date, studioTz);
    if (!instructorId || !range) {
      setBusyIntervalsMin([]);
      setBlockingEventCount(0);
      return;
    }
    setLoading(true);
    const qs = new URLSearchParams({
      teacherID: String(instructorId),
      /* Widen start by 1d so lessons that began yesterday but end today are returned */
      start: new Date(new Date(range.startISO).getTime() - 86400000).toISOString(),
      end: range.endISO,
      limit: "500",
    });
    api
      .get(`/api/calendar?${qs.toString()}`)
      .then((res) => {
        if (!res.success || !Array.isArray(res.data)) {
          setBusyIntervalsMin([]);
          setBlockingEventCount(0);
          return;
        }
        const intervals = [];
        let blocking = 0;
        for (const ev of res.data) {
          if (!statusBlocksAvailability(ev.status)) continue;
          const st = ev.startDateTime ? new Date(ev.startDateTime) : null;
          const en = ev.endDateTime ? new Date(ev.endDateTime) : null;
          if (!st || !en || !(en > st)) continue;
          // Map the instant into studio wall-clock space so a booking lands on
          // the same minutes-from-midnight the calendar grid shows it at — a
          // browser in a different timezone would otherwise clip it elsewhere.
          const clipped = clipIntervalToLocalDay(
            toStudioLocalDate(st, studioTz),
            toStudioLocalDate(en, studioTz),
            range.dayStartMs,
            range.dayEndExclusiveMs,
          );
          if (clipped && clipped.end > clipped.start) {
            intervals.push(clipped);
            blocking += 1;
          }
        }
        setBlockingEventCount(blocking);
        setBusyIntervalsMin(mergeMinuteIntervals(intervals));
      })
      .catch(() => {
        setBusyIntervalsMin([]);
        setBlockingEventCount(0);
      })
      .finally(() => setLoading(false));
  }, [instructorId, date, studioTz]);

  const availableSlots = useMemo(() => {
    const bookingDur = Math.max(15, Number(duration) || 50);
    const stepMins = Math.max(
      15,
      Number(slotStepMins) > 0 ? Number(slotStepMins) : bookingDur,
    );
    const windowEnd = Number(dayEndMin) > 0 ? Number(dayEndMin) : 21 * 60;
    const gridStarts = enumerateAvailabilitySlotStarts(
      slotAlignMins,
      stepMins,
      windowEnd,
      busyIntervalsMin,
      bookingDur,
    );

    const slots = [];
    for (const t of gridStarts) {
      const slotEnd = t + bookingDur;
      const hh = String(Math.floor(t / 60)).padStart(2, "0");
      const mm = String(t % 60).padStart(2, "0");
      const eh = String(Math.floor(slotEnd / 60)).padStart(2, "0");
      const em = String(slotEnd % 60).padStart(2, "0");
      slots.push({ start: `${hh}:${mm}`, end: `${eh}:${em}` });
    }
    return slots;
  }, [busyIntervalsMin, duration, slotStepMins, slotAlignMins, dayEndMin]);

  if (!instructorId || !date) return null;

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Availability · every {slotStepMins || duration || 50} min
          {duration && slotStepMins && Number(duration) !== Number(slotStepMins)
            ? ` · ${duration} min booking`
            : ""}
          {selectedSlots?.length > 1 && (
            <span className="ml-1.5 text-brand">
              ({selectedSlots.length} selected)
            </span>
          )}
        </span>
        {!loading && (
          <span className="text-[10px] text-muted-foreground">
            {availableSlots.length} free · {blockingEventCount} booked
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-1">
          <svg
            className="h-3.5 w-3.5 animate-spin text-muted-foreground"
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
          <span className="text-[11px] text-muted-foreground">
            Checking teacher's schedule…
          </span>
        </div>
      ) : availableSlots.length === 0 ? (
        <p className="text-[11px] text-destructive font-medium py-0.5">
          No available slots on this date.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto pr-1">
          {availableSlots.map((slot) => {
            const isSelected = selectedSlots?.some((s) => s.start === slot.start);
            const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
            const sStart = toMin(slot.start);
            const sEnd = toMin(slot.end);
            const isBlocked = !isSelected && selectedSlots?.some((s) => {
              const selStart = toMin(s.start);
              const selEnd = toMin(s.end);
              return sStart < selEnd && sEnd > selStart;
            });
            return (
              <button
                key={slot.start}
                type="button"
                disabled={isBlocked}
                onClick={() => !isBlocked && onToggleSlot(slot)}
                className={[
                  "px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors shrink-0",
                  isSelected
                    ? "border-brand bg-brand text-brand-foreground"
                    : isBlocked
                    ? "border-border bg-muted/20 text-muted-foreground opacity-40 cursor-not-allowed"
                    : "border-border bg-background text-foreground hover:bg-muted/50 hover:border-brand/40",
                ].join(" ")}
              >
                {formatTime12h(slot.start)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── DateTime row ─────────────────────────────────────────────────────────────

function DateTimeRow({ form, setField, lessonDuration }) {
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-2">
      <div>
        <FieldLabel>Date</FieldLabel>
        <input
          type="date"
          value={form.date}
          onChange={(e) => setField("date", e.target.value)}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary transition-colors"
        />
      </div>
      <div>
        <FieldLabel>Time</FieldLabel>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
          <input
            type="time"
            value={form.start_time}
            onChange={(e) => {
              const newStart = e.target.value;
              setField("start_time", newStart);
              if (newStart && lessonDuration)
                setField("end_time", addMinutes(newStart, lessonDuration));
              // A manual edit here supersedes whatever slot was clicked in the
              // availability grid below — without clearing it, submit still
              // prefers selected_time_slots (see the save handler) and this
              // typed change is silently discarded in favor of the stale
              // fixed-duration slot.
              setField("selected_time_slots", []);
            }}
            className="h-9 w-full rounded-lg border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-primary transition-colors"
          />
          <span className="text-[10px] text-muted-foreground">–</span>
          <input
            type="time"
            value={form.end_time}
            onChange={(e) => {
              setField("end_time", e.target.value);
              // Same reasoning as the start-time handler above.
              setField("selected_time_slots", []);
            }}
            className="h-9 w-full rounded-lg border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Recurrence block ─────────────────────────────────────────────────────────

function RecurrenceBlock({ form, setField }) {
  const isWeekly = form.recurrence_frequency === "weekly";
  const isMonthly = form.recurrence_frequency === "monthly";

  // Whether staff have hand-picked the repeat days. Until they do, the pickers
  // follow the event's own date — previously the default was written once and
  // then frozen, so moving the date after switching Repeat on left the series
  // repeating on the weekday of the date that was originally chosen.
  const weeklyPicked = useRef(false);
  const monthlyPicked = useRef(false);

  // Default to the appointment's own weekday, so the picker never starts out
  // empty and always matches the date shown above it.
  useEffect(() => {
    if (!form.recurrence_enabled || !isWeekly || !form.date) return;
    if (weeklyPicked.current) return;
    const weekday = new Date(`${form.date}T00:00:00`).getDay();
    if (Number.isNaN(weekday)) return;
    if ((form.recurrence_days_of_week || []).join() === String(weekday)) return;
    setField("recurrence_days_of_week", [weekday]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.recurrence_enabled, isWeekly, form.date]);

  // Default to "the Nth weekday this date falls on" — e.g. picking Jul 14 (a
  // Tuesday) defaults to "2nd Tue".
  useEffect(() => {
    if (!form.recurrence_enabled || !isMonthly || !form.date) return;
    if (monthlyPicked.current) return;
    const d = new Date(`${form.date}T00:00:00`);
    if (Number.isNaN(d.getTime())) return;
    const occurrence = Math.ceil(d.getDate() / 7);
    setField("recurrence_monthly_weekday", d.getDay());
    setField("recurrence_monthly_weeks", [occurrence >= 5 ? -1 : occurrence]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.recurrence_enabled, isMonthly, form.date]);

  function toggleDay(value) {
    weeklyPicked.current = true;
    const current = form.recurrence_days_of_week || [];
    const next = current.includes(value)
      ? current.filter((d) => d !== value)
      : [...current, value].sort();
    setField("recurrence_days_of_week", next);
  }

  function toggleMonthlyWeek(value) {
    monthlyPicked.current = true;
    const current = form.recurrence_monthly_weeks || [];
    const next = current.includes(value)
      ? current.filter((w) => w !== value)
      : [...current, value].sort();
    setField("recurrence_monthly_weeks", next);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <RefreshCw className="h-3 w-3" /> Repeat
        </div>
        <Toggle
          checked={form.recurrence_enabled}
          onChange={(v) => setField("recurrence_enabled", v)}
        />
      </div>
      {form.recurrence_enabled && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel>Frequency</FieldLabel>
              <StyledSelect
                value={form.recurrence_frequency}
                onChange={(v) => setField("recurrence_frequency", v)}
                options={FREQUENCY_OPTIONS}
                placeholder="Select"
              />
            </div>
            <div>
              <FieldLabel>Until</FieldLabel>
              <input
                type="date"
                value={form.recurrence_end_date}
                onChange={(e) => setField("recurrence_end_date", e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>
          {isWeekly && (
            <div>
              <FieldLabel>Repeat on</FieldLabel>
              <div className="flex gap-1.5">
                {WEEKDAY_OPTIONS.map((day) => {
                  const active = (form.recurrence_days_of_week || []).includes(
                    day.value,
                  );
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={[
                        "h-8 w-8 shrink-0 rounded-full text-[10px] font-semibold transition-colors",
                        active
                          ? "bg-brand text-brand-foreground"
                          : "bg-background border border-border text-muted-foreground hover:border-primary",
                      ].join(" ")}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {isMonthly && (
            <div className="flex flex-col gap-2">
              <div>
                <FieldLabel>On weekday</FieldLabel>
                <div className="flex gap-1.5">
                  {WEEKDAY_OPTIONS.map((day) => {
                    const active = form.recurrence_monthly_weekday === day.value;
                    return (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => {
                          monthlyPicked.current = true;
                          setField("recurrence_monthly_weekday", day.value);
                        }}
                        className={[
                          "h-8 w-8 shrink-0 rounded-full text-[10px] font-semibold transition-colors",
                          active
                            ? "bg-brand text-brand-foreground"
                            : "bg-background border border-border text-muted-foreground hover:border-primary",
                        ].join(" ")}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <FieldLabel>Which week(s)</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {MONTHLY_WEEK_OPTIONS.map((week) => {
                    const active = (form.recurrence_monthly_weeks || []).includes(
                      week.value,
                    );
                    return (
                      <button
                        key={week.value}
                        type="button"
                        onClick={() => toggleMonthlyWeek(week.value)}
                        className={[
                          "h-8 shrink-0 rounded-full px-3 text-[11px] font-semibold transition-colors",
                          active
                            ? "bg-brand text-brand-foreground"
                            : "bg-background border border-border text-muted-foreground hover:border-primary",
                        ].join(" ")}
                      >
                        {week.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── When section ─────────────────────────────────────────────────────────────

function WhenSection({
  form,
  setField,
  withRecurrence = false,
  lessonDuration,
  slotStepMins,
  slotAlignMins,
  dayEndMin,
  studioTz,
}) {
  function handleToggleSlot(slot) {
    const current = form.selected_time_slots || [];
    const exists = current.some((s) => s.start === slot.start);
    const next = exists
      ? current.filter((s) => s.start !== slot.start)
      : [...current, slot].sort((a, b) => a.start.localeCompare(b.start));
    setField("selected_time_slots", next);
    const first = next[0];
    if (first) {
      setField("start_time", first.start);
      setField("end_time", first.end);
    }
  }

  return (
    <div className="space-y-3">
      <SectionDivider label="When" />
      <DateTimeRow
        form={form}
        setField={setField}
        lessonDuration={lessonDuration}
      />
      {withRecurrence && <RecurrenceBlock form={form} setField={setField} />}
      <AvailabilityPicker
        instructorId={form.instructor_id}
        date={form.date}
        duration={lessonDuration}
        slotStepMins={slotStepMins}
        slotAlignMins={slotAlignMins}
        dayEndMin={dayEndMin}
        selectedSlots={form.selected_time_slots}
        onToggleSlot={handleToggleSlot}
        studioTz={studioTz}
      />
    </div>
  );
}

// ─── Notes block ─────────────────────────────────────────────────────────────

function NotesBlock({ form, setField }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = form.public_note || form.internal_note;
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>Notes{hasContent ? " ·" : ""}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {(expanded || hasContent) && (
        <div className="mt-2 space-y-2">
          <div>
            <FieldLabel>Public Note</FieldLabel>
            <StyledTextArea
              value={form.public_note}
              onChange={(v) => setField("public_note", v)}
              placeholder="Visible to the student…"
            />
          </div>
          <div>
            <FieldLabel>Internal Note</FieldLabel>
            <StyledTextArea
              value={form.internal_note}
              onChange={(v) => setField("internal_note", v)}
              placeholder="Staff only…"
            />
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Tab form components ──────────────────────────────────────────────────────

function AppointmentFields({
  form,
  setField,
  instructorOptions,
  customerOptions,
  rawCustomers,
  lessonDuration,
  slotStepMins,
  slotAlignMins,
  dayEndMin,
  studioTz,
  suggestedAmount,
  onNewCustomer,
  onOpenEnrollmentWizard,
  enrollments,
  allServices,
}) {
  const customerEnrollments = enrollments[form.customer_id] || [];
  const selectedEnr = customerEnrollments.find((e) => String(e._id) === form.enrollment_id);
  const isPayPerSession = selectedEnr?.package?.billingType === "pay_per_session";
  const selectedCatalogSvc = allServices.find((s) => String(s._id) === form.service_id);
  const isChargeableService = selectedCatalogSvc?.isChargeable === true;
  const showSessionPayment = isPayPerSession && isChargeableService;

  const enrollmentSvc = selectedEnr?.package?.services?.find(
    (s) => s.serviceCode === selectedCatalogSvc?.serviceCode,
  );
  const rawPricePerSession = enrollmentSvc?.pricePerSession ?? 0;
  const finalAmount = enrollmentSvc?.finalAmount ?? 0;
  const sessionsTotal = enrollmentSvc?.sessionsTotal ?? 0;
  const sessionsRemaining = enrollmentSvc?.sessionsRemaining ?? sessionsTotal;
  const totalDiscount = Math.max(0, rawPricePerSession * sessionsTotal - finalAmount);
  const hasDiscount = totalDiscount > 0 && rawPricePerSession > 0;
  // Discount spreads across last N sessions from the end — compute charge for current session
  const sessionsUsedNow = sessionsTotal - sessionsRemaining + 1; // 1-indexed session number being booked
  const posFromEnd = sessionsTotal - sessionsUsedNow + 1;
  const discountAbsorbedAfter = posFromEnd > 1 ? Math.min(totalDiscount, rawPricePerSession * (posFromEnd - 1)) : 0;
  const discountForThisSession = Math.min(totalDiscount, rawPricePerSession * posFromEnd) - discountAbsorbedAfter;
  const thisSessionCharge = Math.max(0, rawPricePerSession - discountForThisSession);
  const isLastSession = sessionsRemaining === 1;

  return (
    <div className="space-y-4">
      <WhoSection
        form={form}
        setField={setField}
        instructorOptions={instructorOptions}
        customerOptions={customerOptions}
        rawCustomers={rawCustomers}
        onNewCustomer={onNewCustomer}
        onOpenEnrollmentWizard={onOpenEnrollmentWizard}
        enrollments={enrollments}
        allServices={allServices}
      />
      <WhenSection
        form={form}
        setField={setField}
        withRecurrence
        lessonDuration={lessonDuration}
        slotStepMins={slotStepMins}
        slotAlignMins={slotAlignMins}
        dayEndMin={dayEndMin}
        studioTz={studioTz}
      />
      <div className="space-y-3">
        <SectionDivider label="Notes & Payment" />
        <NotesBlock form={form} setField={setField} />
        {showSessionPayment && (
          <div className="rounded-xl border border-success/20 bg-success/5 px-3 py-2.5 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[12px] font-semibold text-success">
                  Session Payment
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Charged at booking · pay per session
                </p>
              </div>
              {rawPricePerSession > 0 && (
                <div className="text-right shrink-0">
                  {hasDiscount && thisSessionCharge < rawPricePerSession && (
                    <p className="text-[10px] text-muted-foreground line-through">
                      ${rawPricePerSession.toFixed(2)}
                    </p>
                  )}
                  <p className="text-[15px] font-bold text-success">
                    ${thisSessionCharge.toFixed(2)}
                  </p>
                  {hasDiscount && thisSessionCharge === rawPricePerSession && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Discount on last session
                    </p>
                  )}
                </div>
              )}
            </div>
            <div>
              <FieldLabel>Payment Method</FieldLabel>
              <div className="relative">
                <select
                  value={form.session_payment_method}
                  onChange={(e) => setField("session_payment_method", e.target.value)}
                  className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[12px] text-foreground outline-none focus:border-success/20 transition-colors"
                >
                  <option value="">Select method…</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupClassFields({
  form,
  setField,
  instructorOptions,
  schedulingCodeOptions,
  lessonDuration,
  slotStepMins,
  slotAlignMins,
  dayEndMin,
  studioTz,
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <SectionDivider label="Event" />
        <div>
          <FieldLabel>Event Name</FieldLabel>
          <StyledInput
            value={form.title}
            onChange={(v) => setField("title", v)}
            placeholder="e.g. Monday Jazz Group…"
          />
        </div>
        <div>
          <FieldLabel>Teacher</FieldLabel>
          <SearchableSelect
            value={form.instructor_id}
            onChange={(v) => setField("instructor_id", v)}
            options={instructorOptions}
            placeholder="Select teacher…"
          />
        </div>
        <div>
          <FieldLabel>Service Code</FieldLabel>
          <StyledSelect
            value={form.service_id}
            onChange={(v) => setField("service_id", v)}
            options={schedulingCodeOptions}
            placeholder="Select service…"
          />
        </div>
        <div>
          <FieldLabel>Location</FieldLabel>
          <LocationSelector
            value={form.location_id}
            onChange={(v) => setField("location_id", v)}
            multiple={false}
            showAllOption={false}
            placeholder="Select location…"
          />
        </div>
      </div>
      <WhenSection
        form={form}
        setField={setField}
        withRecurrence
        lessonDuration={lessonDuration}
        slotStepMins={slotStepMins}
        slotAlignMins={slotAlignMins}
        dayEndMin={dayEndMin}
        studioTz={studioTz}
      />
      <div className="space-y-3">
        <SectionDivider label="Notes" />
        <NotesBlock form={form} setField={setField} />
      </div>
      <div className="rounded-xl border border-info/20 bg-info/5 px-3 py-2.5">
        <p className="text-[11px] font-medium text-info">
          Students are added after the event is created — click the event on the calendar to enroll students.
        </p>
      </div>
    </div>
  );
}

function ToDoFields({
  form,
  setField,
  instructorOptions,
  todoOptions,
  todoMap,
  lessonDuration,
  slotStepMins,
  slotAlignMins,
  dayEndMin,
  studioTz,
}) {
  function handleTodoChange(id) {
    setField("todo_id", id);
    const todo = todoMap[id];
    if (todo?.name) setField("title", todo.name);
    if (todo?.color) setField("event_color", todo.color);
    if (todo?.duration && form.start_time) {
      setField("end_time", addMinutes(form.start_time, todo.duration));
      // Same reasoning as the manual time-edit handlers in DateTimeRow: any
      // slot already picked from the availability grid (fixed to the studio's
      // generic slot width) is now stale — without clearing it, submit still
      // prefers selected_time_slots over this freshly computed end time.
      setField("selected_time_slots", []);
    }
  }
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <SectionDivider label="Task" />
        <div>
          <FieldLabel>To-Do</FieldLabel>
          <StyledSelect
            value={form.todo_id}
            onChange={handleTodoChange}
            options={todoOptions}
            placeholder="Select to-do…"
          />
        </div>
        <div>
          <FieldLabel>Title</FieldLabel>
          <StyledInput
            value={form.title}
            onChange={(v) => setField("title", v)}
            placeholder="Task title…"
          />
        </div>
        <div>
          <FieldLabel>Assigned To</FieldLabel>
          <MultiSelectCheckboxDropdown
            options={instructorOptions}
            values={form.instructor_ids}
            onChange={(v) => setField("instructor_ids", v)}
            placeholder="Select teachers…"
            showSelectAll
          />
        </div>
      </div>
      <WhenSection
        form={form}
        setField={setField}
        withRecurrence
        lessonDuration={lessonDuration}
        slotStepMins={slotStepMins}
        slotAlignMins={slotAlignMins}
        dayEndMin={dayEndMin}
        studioTz={studioTz}
      />
      <div className="space-y-3">
        <SectionDivider label="Notes" />
        <NotesBlock form={form} setField={setField} />
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function AppointmentComposerPanel({
  open,
  onClose,
  onCreated,
  initialDate,
  initialTime,
  initialInstructorId,
  initialDuration,
  initialSlotAlignMins,
  initialDayEndHour,
  studioTz,
}) {
  const [activeTab, setActiveTab] = useState("Appointment");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [instructorOptions, setInstructorOptions] = useState([]);
  const [customerOptions, setCustomerOptions] = useState([]);
  const [rawCustomers, setRawCustomers] = useState([]);
  const [lessonOptions, setLessonOptions] = useState([]);
  const [lessonMap, setLessonMap] = useState({});
  const [lessonByName, setLessonByName] = useState({});
  const [todoOptions, setTodoOptions] = useState([]);
  const [todoMap, setTodoMap] = useState({});
  const [allServices, setAllServices] = useState([]);
  const [packageOptions, setPackageOptions] = useState([]);
  const [packageTemplates, setPackageTemplates] = useState([]);
  const [allEnrollmentsForGroupFilter, setAllEnrollmentsForGroupFilter] = useState([]);
  const [enrollments, setEnrollments] = useState({});
  const [showEnrollmentWizard, setShowEnrollmentWizard] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  // Set when the backend answers 409 needsUnallocatedConfirm — holds everything
  // needed to re-post just the uncovered slots once staff confirm.
  const [unallocatedPrompt, setUnallocatedPrompt] = useState(null);

  useEffect(() => {
    if (!open) return;
    setActiveTab("Appointment");
    setShowEnrollmentWizard(false);
    setError(null);
    const seededEndTime = initialTime
      ? initialDuration
        ? addMinutes(initialTime, initialDuration)
        : bumpHour(initialTime)
      : "";
    setForm({
      ...EMPTY_FORM,
      // Prefill the Group Class location with the user's active studio so it
      // doesn't have to be re-picked; still editable via the Location field.
      location_id: getEffectiveBranch() || "",
      date: initialDate || "",
      start_time: initialTime || "",
      end_time: seededEndTime,
      instructor_id: initialInstructorId ? String(initialInstructorId) : "",
      instructor_ids: initialInstructorId ? [String(initialInstructorId)] : [],
      selected_time_slots: initialTime
        ? [{ start: initialTime, end: seededEndTime }]
        : [],
    });
  }, [open, initialDate, initialTime, initialInstructorId, initialDuration]);

  const setField = (key, value) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleTabChange = (key) => {
    setActiveTab(key);
  setShowEnrollmentWizard(false);
    setForm((prev) => ({
      ...prev,
      customer_id: "",
      customer_ids: [],
      // Preserve the day-view teacher for the To Do tab's multi-select; the single
      // instructor_id intentionally persists across tabs (matches main).
      instructor_ids:
        key === "To Do" && initialInstructorId ? [String(initialInstructorId)] : [],
      service_id: "",
      lesson_id: "",
      todo_id: "",
      enrollment_id: "",
      customer_membership_id: "",
      event_color: "",
    }));
    setError(null);
  };

  useEffect(() => {
    async function load() {
      try {
        const [usersRes, customersRes, lessonsRes, packagesRes, servicesRes, customerPkgRes, todosRes] =
          await Promise.all([
            api.get("/api/teacher?limit=200&status=active"),
            api.get("/api/customer?limit=200"),
            api.get("/api/lesson?limit=200"),
            api.get("/api/package?limit=200"),
            api.get("/api/calendar-service?limit=200"),
            api.get("/api/customer-package?limit=500"),
            api.get("/api/todo?limit=200&isActive=true"),
          ]);

        if (usersRes.success && Array.isArray(usersRes.data))
          setInstructorOptions(
            usersRes.data.map((t) => ({
              value: String(t._id ?? t.id),
              label: t.name || t.email || String(t._id),
            })),
          );

        if (customersRes.success && Array.isArray(customersRes.data)) {
          setRawCustomers(customersRes.data);
          setCustomerOptions(
            customersRes.data.map((c) => ({
              value: String(c._id ?? c.id),
              label: c.name || c.email || String(c._id),
            })),
          );
        }

        // Store raw enrollments for later cross-referencing once calendarServices are loaded
        if (customerPkgRes.success && Array.isArray(customerPkgRes.data)) {
          setAllEnrollmentsForGroupFilter(customerPkgRes.data);
        }

        if (lessonsRes.success && Array.isArray(lessonsRes.data)) {
          const map = {};
          const byName = {};
          lessonsRes.data.forEach((l) => {
            map[String(l._id)] = l;
            if (l.name) byName[l.name.toLowerCase()] = l;
          });
          setLessonMap(map);
          setLessonByName(byName);
          setLessonOptions(
            lessonsRes.data.map((l) => ({
              value: String(l._id),
              label: l.name,
            })),
          );
        }

        if (todosRes.success && Array.isArray(todosRes.data)) {
          const tMap = {};
          todosRes.data.forEach((t) => { tMap[String(t._id)] = t; });
          setTodoMap(tMap);
          setTodoOptions(
            todosRes.data.map((t) => ({ value: String(t._id), label: t.name })),
          );
        }

        if (servicesRes.success && Array.isArray(servicesRes.data)) {
          setAllServices(servicesRes.data);
        }

        if (packagesRes.success && Array.isArray(packagesRes.data)) {
          setPackageTemplates(packagesRes.data);
          setPackageOptions(
            packagesRes.data.map((p) => ({
              value: String(p._id),
              label: p.packageName || String(p._id),
            })),
          );
        }
      } catch {
        setError("Failed to load form options. Please close and reopen.");
      }
    }
    load();
  }, []);

  // Load enrollments when customer is selected (Appointment tab)
  useEffect(() => {
    if (!form.customer_id) return;
    api
      .get(`/api/enrollment?customerID=${form.customer_id}`)
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setEnrollments((prev) => ({ ...prev, [form.customer_id]: res.data }));
        }
      })
      .catch(() => {});
  }, [form.customer_id]);

  const SERVICE_TYPE_MAP = {
    Appointment: "private",
    "Group Class": "group",
    "To Do": "todo",
  };

  const schedulingCodeOptions = useMemo(() => {
    const typeFilter = SERVICE_TYPE_MAP[activeTab];
    return allServices
      .filter((s) => {
        if (activeTab === "Appointment")
          return !s.type || s.type === "private" || s.type === "intro";
        return !typeFilter || s.type === typeFilter;
      })
      .map((s) => ({
        value: String(s._id),
        label: s.serviceCode || s.serviceName,
      }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allServices, activeTab]);

  const suggestedAmount = useMemo(() => {
    if (!form.service_id) return null;
    const svc = allServices.find((s) => String(s._id) === form.service_id);
    return svc?.price > 0 ? svc.price : null;
  }, [form.service_id, allServices]);

  const lessonDuration = useMemo(() => {
    // To-Do tab: the selected to-do's own catalog duration drives both the
    // availability grid's slot width and the auto-computed end time — without
    // this, a 120-minute to-do like "Lunch" got the studio's generic default
    // slot length (e.g. 50m) instead, and every availability-grid button
    // offered only a 50m block regardless of what the to-do actually needs.
    if (form.todo_id) {
      const todo = todoMap[form.todo_id];
      if (todo?.duration) return Number(todo.duration);
    }
    if (form.lesson_id) {
      const lesson = lessonMap[form.lesson_id];
      if (lesson?.duration) return Number(lesson.duration);
    }
    if (form.service_id) {
      const svc = allServices.find((s) => String(s._id) === form.service_id);
      const lesson = svc?.serviceName
        ? lessonByName[svc.serviceName.toLowerCase()]
        : null;
      if (lesson?.duration) return Number(lesson.duration);
    }
    return initialDuration || 60;
  }, [
    form.todo_id,
    form.lesson_id,
    form.service_id,
    allServices,
    lessonByName,
    lessonMap,
    todoMap,
    initialDuration,
  ]);

  const handleNewCustomer = async ({ name, email, phoneNumber, locationID }) => {
    const result = await api.post("/api/customer", {
      name,
      email,
      phoneNumber,
      locationID,
    });
    if (result.success && result.data) {
      const c = result.data;
      const newId = String(c._id);
      setCustomerOptions((prev) => [
        ...prev,
        { value: newId, label: c.name || c.email || newId },
      ]);
      setRawCustomers((prev) => [...prev, c]);
      return newId;
    }
    return null;
  };

  // One-time packages are settled in full at purchase via billing.method, so
  // they need no separate record here. Payment plans collect the first
  // installment; flexible packages collect an ad-hoc initial amount.
  const recordInitialPayment = async (customerID, enrollmentID, payload) => {
    const { billingType, billing } = payload;
    if (!billing?.collectNow || !(Number(billing.collectAmount) > 0)) return null;
    const method = billing.method || "cash";

    if (billingType === "payment_plan") {
      const planRes = await api.get(`/api/payment-plan/customer/${customerID}`);
      const plans = planRes.success ? planRes.data || [] : [];
      const matchesEnrollment = (p) =>
        String(p.enrollmentID?._id ?? p.enrollmentID) === String(enrollmentID);
      const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
      // Prefer the plan tied to this enrollment; fall back to the most recently
      // created plan (the one we just made) if the reference shape differs.
      const plan =
        plans.filter(matchesEnrollment).sort(byNewest)[0] ??
        [...plans].sort(byNewest)[0];
      const firstPending = (plan?.installments || []).findIndex((i) => i.status === "pending");
      if (!plan || firstPending === -1) {
        console.error("Initial installment not collected: no pending plan found", { enrollmentID, plans });
        return null;
      }
      const payRes = await api.post(`/api/payment-plan/${plan._id}/pay-installment`, {
        installmentIndex: firstPending,
        method,
        paymentDate: billing.collectDate || undefined,
      });
      if (!payRes.success) {
        console.error("pay-installment failed", payRes);
        return null;
      }
      return payRes.data?.checkoutUrl || null;
    }

    if (billingType === "flexible") {
      const payRes = await api.post("/api/payment", {
        customerID,
        enrollmentID,
        type: "package_purchase",
        amount: Number(billing.collectAmount),
        method,
        paymentDate: billing.collectDate || undefined,
      });
      return payRes.data?.checkoutUrl || null;
    }
    return null;
  };

  const handleNewEnrollment = async (customerID, payload = {}) => {
    if (!customerID) return null;
    const enrRes = await api.post("/api/enrollment", {
      customerID,
      label: payload.label?.trim() || undefined,
      teacherID: payload.teacherID || undefined,
    });
    if (!enrRes.success) return null;

    const enrollment =
      enrRes?.data?.enrollment && typeof enrRes.data.enrollment === "object"
        ? enrRes.data.enrollment
        : enrRes.data;
    const enrollmentID = String(
      enrollment?._id || enrollment?.enrollmentID || "",
    );
    if (!enrollmentID) return null;

    const addRes = await api.post("/api/customer-package/add", {
      customerID,
      packageID: payload.packageID,
      enrollmentID,
      services: (payload.services || []).map((s) => ({
        serviceCode: s.serviceCode,
        serviceName: s.serviceName,
        color: s.color,
        numberOfSessions: Number(s.numberOfSessions || 0),
        pricePerSession: Number(s.pricePerSession || 0),
        discountType: s.discountType || "none",
        discountAmount: Number(s.discountAmount || 0),
        finalAmount: Number(s.finalAmount || 0),
      })),
      billingType: payload.billingType,
      billing:
        payload.billingType === "one_time"
          ? {
              method: payload.billing?.method || "cash",
              collectDate: payload.billing?.collectDate || undefined,
            }
          : payload.billingType === "payment_plan"
            ? {
                installmentMode: payload.billing?.installmentMode || "count",
                numberOfInstallments: Number(
                  payload.billing?.numberOfInstallments || 0,
                ),
                installmentAmount:
                  payload.billing?.installmentMode === "amount"
                    ? Number(payload.billing?.installmentAmount || 0)
                    : undefined,
                frequency: payload.billing?.frequency,
                startDate: payload.billing?.startDate,
              }
            : payload.billingType === "flexible"
              ? { dueDate: payload.billing?.dueDate || undefined }
              : {},
      ...(payload.purchaseDate ? { purchaseDate: payload.purchaseDate } : {}),
      ...(payload.tip?.teacherID && payload.tip?.amount
        ? {
            tip: {
              teacherID: payload.tip.teacherID,
              amount: Number(payload.tip.amount),
              method: payload.tip.method || "cash",
              notes: payload.tip.notes,
            },
          }
        : {}),
    });
    if (!addRes.success) return null;

    const checkoutUrl =
      payload.billingType === "one_time"
        ? addRes.data?.checkoutUrl || null
        : await recordInitialPayment(customerID, enrollmentID, payload);

    const listRes = await api.get(`/api/enrollment?customerID=${customerID}`);
    if (listRes.success && Array.isArray(listRes.data)) {
      setEnrollments((prev) => ({ ...prev, [customerID]: listRes.data }));
    }
    return { enrollmentID, checkoutUrl };
  };

  const handleSave = async () => {
    setError(null);
    setUnallocatedPrompt(null);
    setIsSaving(true);

    // Derive Package template ID and check billing type from selected enrollment
    let packageTemplateId;
    let selectedBillingType = null;
    if (form.enrollment_id && form.customer_id) {
      const customerEnrollments = enrollments[form.customer_id] || [];
      const selectedEnr = customerEnrollments.find(
        (e) => String(e._id) === form.enrollment_id,
      );
      const cp = selectedEnr?.packageID;
      packageTemplateId = cp?.packageID?._id || cp?.packageID || undefined;
      selectedBillingType = selectedEnr?.package?.billingType ?? null;
    }

    // Validate: Appointment tab requires a student to be selected
    if (activeTab === "Appointment" && !form.customer_id) {
      setError("Please select a student before booking.");
      setIsSaving(false);
      return;
    }

    // Validate: an incomplete Repeat rule used to be dropped silently — the
    // payload fell back to `{ enabled: false }` and a single event was created,
    // so staff believed they had scheduled a whole series.
    if (form.recurrence_enabled) {
      const repeatError = validateRecurrence(form);
      if (repeatError) {
        setError(repeatError);
        setIsSaving(false);
        return;
      }
    }

    // Validate: pay_per_session requires a payment method when booking a chargeable service
    const isChargeableSelected = tabCatalogServices?.find?.((s) => String(s._id) === form.service_id)?.isChargeable === true;
    if (selectedBillingType === "pay_per_session" && isChargeableSelected && !form.session_payment_method) {
      setError("Select a payment method for this pay-per-session booking.");
      setIsSaving(false);
      return;
    }

    // Create location comes from the customer / lesson / todo — never the header
    // branch filter (header is view-only). Prefer the selected customer's studio.
    // Group Class events have none of those at creation time (students are
    // enrolled afterward), so they fall back to the explicit Location field.
    const selectedCustomer = form.customer_id
      ? rawCustomers.find((c) => String(c._id) === String(form.customer_id))
      : null;
    const selectedLesson = form.lesson_id ? lessonMap[String(form.lesson_id)] : null;
    const selectedTodo = form.todo_id ? todoMap[String(form.todo_id)] : null;
    // A customer/lesson/to-do can be assigned to several studios; picking
    // whichever one happened to sort first ignored the studio the user is
    // actually working in, so a to-do would silently get booked under (or
    // filtered out of) the wrong location after switching studios. Prefer
    // the currently active studio when it's one of the entity's valid
    // locations, and only fall back to the first one otherwise.
    const activeBranchId = getEffectiveBranch();
    const firstLoc = (raw) => {
      if (!raw) return undefined;
      const ids = Array.isArray(raw) ? raw.map((r) => r?._id || r).filter(Boolean) : [raw._id || raw];
      if (!ids.length) return undefined;
      const activeMatch = activeBranchId && ids.find((id) => String(id) === String(activeBranchId));
      return activeMatch || ids[0];
    };
    const createLocationID =
      firstLoc(selectedCustomer?.locationID) ||
      firstLoc(selectedLesson?.locationID) ||
      firstLoc(selectedTodo?.locationID) ||
      form.location_id ||
      undefined;

    if ((activeTab === "Group Class" || activeTab === "To Do") && !createLocationID) {
      setError(
        activeTab === "To Do"
          ? "This to-do isn't assigned to any location. Add a location to it under Settings."
          : "Select a location to create this group class.",
      );
      setIsSaving(false);
      return;
    }

    const basePayload = {
      title:
        form.title ||
        TABS.find((t) => t.key === activeTab)?.label ||
        "Appointment",
      type: TAB_TYPE_MAP[activeTab],
      locationID: createLocationID || undefined,
      // To-dos can be assigned to many teachers (teacherIDs); teacherID stays set
      // to the first for back-compat with single-teacher rendering/other types.
      teacherID:
        (activeTab === "To Do" ? form.instructor_ids?.[0] : form.instructor_id) ||
        undefined,
      teacherIDs:
        activeTab === "To Do" && form.instructor_ids?.length
          ? form.instructor_ids
          : undefined,
      todoID: activeTab === "To Do" ? form.todo_id || undefined : undefined,
      customerIDs:
        activeTab === "Group Class"
          ? undefined
          : form.customer_id
            ? [form.customer_id]
            : undefined,
      memberIDs: form.member_ids?.length > 0 ? form.member_ids : undefined,
      lessonID: form.lesson_id || undefined,
      calendarServiceID: form.service_id || undefined,
      enrollmentID: activeTab === "Group Class" ? undefined : form.enrollment_id || undefined,
      customerMembershipID:
        activeTab === "Group Class" ? undefined : form.customer_membership_id || undefined,
      packageID: packageTemplateId || undefined,
      color: form.event_color || undefined,
      notes:
        [form.public_note, form.internal_note].filter(Boolean).join("\n") ||
        undefined,
      recurrence:
        form.recurrence_enabled &&
        form.recurrence_frequency &&
        form.recurrence_end_date
          ? {
              enabled: true,
              frequency: form.recurrence_frequency,
              endDate: form.recurrence_end_date,
              daysOfWeek:
                form.recurrence_frequency === "weekly" &&
                form.recurrence_days_of_week?.length > 0
                  ? form.recurrence_days_of_week
                  : undefined,
              monthlyWeekday:
                form.recurrence_frequency === "monthly" &&
                form.recurrence_monthly_weekday != null &&
                form.recurrence_monthly_weeks?.length > 0
                  ? form.recurrence_monthly_weekday
                  : undefined,
              monthlyWeeks:
                form.recurrence_frequency === "monthly" &&
                form.recurrence_monthly_weekday != null &&
                form.recurrence_monthly_weeks?.length > 0
                  ? form.recurrence_monthly_weeks
                  : undefined,
            }
          : { enabled: false },
      payment: form.payment_collected
        ? {
            amount:
              form.payment_amount !== ""
                ? Number(form.payment_amount)
                : undefined,
            method: form.payment_method || undefined,
            collected: true,
          }
        : undefined,
      billing: form.session_payment_method
        ? { method: form.session_payment_method }
        : undefined,
    };

    const slots =
      form.selected_time_slots?.length > 0
        ? form.selected_time_slots
        : form.start_time
          ? [{ start: form.start_time, end: form.end_time }]
          : [];

    if (slots.length === 0) {
      setError("Please select a time slot or enter a start time.");
      setIsSaving(false);
      return;
    }

    // Interpret the typed time as wall-clock time in the STUDIO's timezone,
    // not the browser's — a US-based admin typing "10am" for an India studio
    // must create the event at 10am India time, not 10am US time converted.
    const payloads = slots.map((slot) => ({
      ...basePayload,
      startDateTime: studioWallTimeToUtcISO(form.date, slot.start, studioTz),
      endDateTime: studioWallTimeToUtcISO(form.date, slot.end, studioTz),
    }));

    const results = await Promise.all(
      payloads.map((p) => api.post("/api/calendar", p)),
    );

    // The backend refuses to book a lesson no program covers until staff say so.
    // Only the slots that actually came back needing confirmation are retried —
    // on a partially covered booking the others are already created, and
    // re-posting them would duplicate the lesson.
    const needsConfirm = results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => !r.success && r.errorData?.needsUnallocatedConfirm);

    if (needsConfirm.length > 0) {
      setUnallocatedPrompt({
        message: needsConfirm[0].r.error,
        count: needsConfirm.length,
        payloads,
        results,
        indexes: needsConfirm.map(({ i }) => i),
      });
      setIsSaving(false);
      return;
    }

    finishSave(results);
  };

  // Re-post only the slots that need confirming, merge them back into the
  // original result set, and finish as though they had succeeded first time.
  const confirmUnallocated = async () => {
    const prompt = unallocatedPrompt;
    if (!prompt) return;
    setUnallocatedPrompt(null);
    setIsSaving(true);
    setError(null);

    const retried = await Promise.all(
      prompt.indexes.map((i) =>
        api.post("/api/calendar", {
          ...prompt.payloads[i],
          allowUnallocated: true,
        }),
      ),
    );
    const merged = [...prompt.results];
    prompt.indexes.forEach((slotIndex, k) => {
      merged[slotIndex] = retried[k];
    });

    finishSave(merged);
  };

  const finishSave = (results) => {
    const firstFailure = results.find((r) => !r.success);

    if (!firstFailure) {
      // Resolve the selected member IDs to names now, while we still have the full
      // customer object — the calendar GET response does not populate member sub-docs.
      const selCustomer = rawCustomers.find((c) => String(c._id) === form.customer_id);
      const selMemberNames = (selCustomer?.members || [])
        .filter((m) => form.member_ids?.map(String).includes(String(m._id)))
        .map((m) => m.name)
        .filter(Boolean);
      if (form.customer_id && selMemberNames.length > 0) {
        const memberMap = {};
        results.forEach((r) => {
          const d = r.data;
          const id = d?.calendarEvent?._id ?? d?._id ?? d?.id;
          if (r.success && id) {
            memberMap[String(id)] = { [String(form.customer_id)]: selMemberNames };
          }
        });
        onCreated?.(Object.keys(memberMap).length > 0 ? memberMap : null);
      } else {
        onCreated?.();
      }
      onClose();
    } else {
      setError(firstFailure.error || "Failed to save. Please try again.");
    }
    setIsSaving(false);
  };

  const privateServices = useMemo(
    () =>
      allServices.filter((s) => !s.type || s.type === "private" || s.type === "intro"),
    [allServices],
  );

  const groupServices = useMemo(
    () => allServices.filter((s) => s.type === "group"),
    [allServices],
  );

  // Build a set of serviceCodes that have type=group in the catalog
  const groupServiceCodes = useMemo(
    () => new Set(allServices.filter((s) => s.type === "group").map((s) => s.serviceCode)),
    [allServices],
  );

  // Customers who have at least one active enrollment containing a group service
  const groupCustomerOptions = useMemo(() => {
    if (!groupServiceCodes.size || !allEnrollmentsForGroupFilter.length) return customerOptions;
    const ids = new Set();
    allEnrollmentsForGroupFilter.forEach((enrollment) => {
      const services = enrollment.package?.services ?? [];
      if (services.some((s) => groupServiceCodes.has(s.serviceCode))) {
        const cid = enrollment.customerID?._id ?? enrollment.customerID;
        if (cid) ids.add(String(cid));
      }
    });
    return customerOptions.filter((c) => ids.has(c.value));
  }, [allEnrollmentsForGroupFilter, groupServiceCodes, customerOptions]);

  const tabCatalogServices = useMemo(() => {
    if (activeTab === "Appointment") return privateServices;
    if (activeTab === "Group Class") return groupServices;
    return allServices;
  }, [activeTab, privateServices, groupServices, allServices]);

  const wizardAllowedServiceCodes = useMemo(
    () => new Set(tabCatalogServices.map((s) => s.serviceCode).filter(Boolean)),
    [tabCatalogServices],
  );

  const slotStepMins = initialDuration || 30;
  const slotAlignMins =
    initialSlotAlignMins != null ? initialSlotAlignMins : 6 * 60;
  const dayEndMin = (initialDayEndHour ?? 21) * 60;

  const sharedProps = {
    form,
    setField,
    instructorOptions,
    customerOptions,
    lessonOptions,
    lessonMap,
    allServices: tabCatalogServices,
    schedulingCodeOptions,
    lessonDuration,
    slotStepMins,
    slotAlignMins,
    dayEndMin,
    studioTz,
    suggestedAmount,
    packageOptions,
    packageTemplates,
    enrollments,
    rawCustomers,
    onNewCustomer: handleNewCustomer,
    onOpenEnrollmentWizard: (open = true) => setShowEnrollmentWizard(Boolean(open)),
  };

  const tabContent = useMemo(() => {
    if (showEnrollmentWizard) {
      return (
        <NewEnrollmentPackageInline
          teacherOptions={instructorOptions}
          packageTemplates={packageTemplates}
          customerID={form.customer_id || undefined}
          locationID={(() => {
            const c = rawCustomers?.find((x) => String(x._id) === String(form.customer_id))
            const loc = c?.locationID
            if (!loc) return undefined
            if (Array.isArray(loc)) return loc[0]?._id || loc[0] || undefined
            return loc._id || loc
          })()}
          onCancel={() => setShowEnrollmentWizard(false)}
          onSubmit={async (payload) => {
            const created = await handleNewEnrollment(form.customer_id, payload);
            const createdId = created?.enrollmentID;
            if (createdId) {
              setField("enrollment_id", String(createdId));
              // Auto-select the service if exactly one package service matches the current tab's catalog
              const matchingServices = (payload.services || []).filter((s) =>
                tabCatalogServices.some((cat) => cat.serviceCode === s.serviceCode),
              );
              if (matchingServices.length === 1) {
                const catalogSvc = tabCatalogServices.find(
                  (cat) => cat.serviceCode === matchingServices[0].serviceCode,
                );
                if (catalogSvc) {
                  setField("service_id", String(catalogSvc._id));
                  const color = matchingServices[0].color || catalogSvc.color;
                  if (color) setField("event_color", color);
                } else {
                  setField("service_id", "");
                }
              } else {
                setField("service_id", "");
              }
              setShowEnrollmentWizard(false);
              return { ok: true, checkoutUrl: created?.checkoutUrl || null };
            }
            return { ok: false, checkoutUrl: null };
          }}
        />
      );
    }
    if (activeTab === "Appointment")
      return <AppointmentFields {...sharedProps} />;
    if (activeTab === "Group Class")
      return (
        <GroupClassFields
          form={form}
          setField={setField}
          instructorOptions={instructorOptions}
          schedulingCodeOptions={schedulingCodeOptions}
          lessonDuration={lessonDuration}
          slotStepMins={slotStepMins}
          slotAlignMins={slotAlignMins}
          dayEndMin={dayEndMin}
          studioTz={studioTz}
        />
      );
    if (activeTab === "To Do")
      return (
        <ToDoFields
          form={form}
          setField={setField}
          instructorOptions={instructorOptions}
          todoOptions={todoOptions}
          todoMap={todoMap}
          lessonDuration={lessonDuration}
          slotStepMins={slotStepMins}
          slotAlignMins={slotAlignMins}
          dayEndMin={dayEndMin}
          studioTz={studioTz}
        />
      );
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    showEnrollmentWizard,
    form,
    instructorOptions,
    customerOptions,
    lessonOptions,
    todoOptions,
    todoMap,
    schedulingCodeOptions,
    lessonMap,
    lessonDuration,
    packageOptions,
    packageTemplates,
    allServices,
    enrollments,
    rawCustomers,
    studioTz,
  ]);

  const slotCount = form.selected_time_slots?.length ?? 0;
  const saveLabel = isSaving
    ? slotCount > 1
      ? `Creating ${slotCount} events…`
      : "Saving…"
    : slotCount > 1
      ? `Book ${slotCount} Appointments`
      : TAB_SAVE_LABEL[activeTab] || "Save";

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetContent
        onClose={showEnrollmentWizard ? undefined : onClose}
        className="flex flex-col overflow-hidden p-0"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-border bg-muted/30">
          <div className={`flex items-center justify-between px-5 ${showEnrollmentWizard ? "pt-5 pb-2" : "pt-4 pb-0"}`}>
            {showEnrollmentWizard ? (
              <button
                type="button"
                onClick={() => setShowEnrollmentWizard(false)}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground hover:text-brand"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Booking
              </button>
            ) : (
              <p className="text-[14px] font-bold text-foreground">New Booking</p>
            )}
          </div>
          {!showEnrollmentWizard && (
            <div className="flex overflow-x-auto scrollbar-hide px-4 pb-0 gap-0.5 mt-2">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => handleTabChange(key)}
                className={[
                  "flex items-center gap-1.5 shrink-0 px-3 py-2 text-[11px] font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap",
                  activeTab === key
                    ? "text-brand border-brand bg-background"
                    : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/40",
                ].join(" ")}
              >
                <Icon className="h-3 w-3 shrink-0" />
                {label}
              </button>
            ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">{tabContent}</div>

        {/* Error */}
        {error && (
          <div className="shrink-0 mx-5 mb-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-[12px] text-destructive">
            {error}
          </div>
        )}

        {/* Unallocated confirmation — the booking is refused until staff say yes */}
        {unallocatedPrompt && (
          <div className="shrink-0 mx-5 mb-2 rounded-lg bg-warning/10 border border-warning/30 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
              <p className="text-[12px] text-warning leading-relaxed">
                {unallocatedPrompt.message}
              </p>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={confirmUnallocated}
                className="h-8 px-3 rounded-lg bg-warning text-[11px] font-semibold text-warning-foreground hover:opacity-90 transition-opacity"
              >
                Book unallocated
              </button>
              <button
                type="button"
                onClick={() => setUnallocatedPrompt(null)}
                className="h-8 px-3 rounded-lg border border-border bg-background text-[11px] font-semibold text-foreground hover:bg-muted/40 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        {!showEnrollmentWizard && (
          <div className="shrink-0 border-t border-border bg-muted/20 px-5 py-3 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg border border-border bg-background text-[12px] font-semibold text-foreground hover:bg-muted/40 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 h-9 rounded-lg bg-brand text-[12px] font-semibold text-brand-foreground hover:bg-brand-dark disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {saveLabel}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
