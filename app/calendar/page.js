"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import MainLayout from "@/components/layout/MainLayout";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Settings2 } from "lucide-react";
import AppointmentComposerPanel from "./components/AppointmentComposerPanel";
import EventDetailPanel from "./components/EventDetailPanel";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { toStudioLocalDate } from "@/lib/studioLocalDate";
import { getCurrentUserId, getEffectiveBranch } from "@/lib/auth";
import { isOwnScope } from "@/lib/permissions";

const COLORS = {
  border: "hsl(var(--border))",
  shadow: "0px 2px 5px 0px hsl(var(--foreground) / 0.06)",
};

// Visually distinct hues — works on both light and dark backgrounds
const CALENDAR_PALETTE = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#ef4444", // red
];

const VIEW_MODE = { DAY: "day", WEEK: "week", MONTH: "month", LIST: "list" };
const FULLCALENDAR_VIEW = {
  [VIEW_MODE.DAY]: "timeGridDay",
  [VIEW_MODE.WEEK]: "timeGridWeek",
  [VIEW_MODE.MONTH]: "dayGridMonth",
};
const FULL_START_HOUR = 6;
/** Exclusive end of visible grid (24 = through end of day; 23:00 events need room). */
const FULL_END_HOUR = 24;
/** Default grid slot duration (day + week views, new bookings). */
const DEFAULT_SLOT_MINS = 50;
/** Fixed px height for every time-slot row (day + week), regardless of slot duration (30/45/60/90m). */
const TIME_SLOT_ROW_MIN_HEIGHT_PX = 60;
const DAY_LEFT_RAIL_WIDTH = 86;
/** Fixed display height for all timed booking cards (private + group); fits title, teacher, time, badges. */
const TIMED_EVENT_CARD_DISPLAY_HEIGHT_PX = 60;
/** Floor so a very short booking (e.g. 10m) still has room for its title line when sized by duration. */
const TIMED_EVENT_CARD_MIN_HEIGHT_PX = 28;
/** Vertical gap when stacking overlapping bookings (day view + FullCalendar week). */
const TIMED_EVENT_CARD_STACK_GAP_PX = 2;
/** Week view: cards shown before "+N more" for same instructor + same time range. */
const WEEK_SAME_SLOT_MAX_VISIBLE = 1;
const BOOKING_CARD_SHELL_CLASS =
  "booking-card-shell h-full w-full min-h-0 min-w-0 overflow-hidden rounded-[5px] flex flex-col box-border";

function getEventDurationMins(event) {
  if (!event?.end || !event?.start) return 0;
  return Math.max(
    0,
    Math.round((new Date(event.end) - new Date(event.start)) / 60000),
  );
}

/** Force fixed booking card size on FullCalendar harness (week + month). */
function applyTimedEventCardLayout(harness) {
  if (!harness) return;
  const h = TIMED_EVENT_CARD_DISPLAY_HEIGHT_PX;
  harness.style.setProperty("height", `${h}px`, "important");
  harness.style.setProperty("min-height", `${h}px`, "important");
  harness.style.setProperty("max-height", `${h}px`, "important");
  harness.style.setProperty("bottom", "auto", "important");
  harness.style.setProperty("left", "0", "important");
  harness.style.setProperty("right", "0", "important");
  harness.style.setProperty("width", "100%", "important");
  harness.style.setProperty("margin-left", "0", "important");
  harness.style.setProperty("margin-right", "0", "important");

  const eventEl = harness.querySelector(".fc-event");
  if (!eventEl) return;
  eventEl.style.setProperty("width", "100%", "important");
  eventEl.style.setProperty("min-height", `${h}px`, "important");
  eventEl.style.setProperty("height", `${h}px`, "important");
  eventEl.style.setProperty("max-height", `${h}px`, "important");
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function mapViewTypeToMode(viewType) {
  if (viewType === "timeGridDay") return VIEW_MODE.DAY;
  if (viewType === "timeGridWeek") return VIEW_MODE.WEEK;
  return VIEW_MODE.MONTH;
}

function isSameDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfWeekSunday(date) {
  const base = new Date(date);
  base.setDate(base.getDate() - base.getDay());
  base.setHours(0, 0, 0, 0);
  return base;
}

function formatHeaderLabel(date, mode) {
  if (mode === VIEW_MODE.DAY) {
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  if (mode === VIEW_MODE.WEEK) {
    const start = startOfWeekSunday(date);
    const end = addDays(start, 6);
    if (start.getMonth() === end.getMonth()) {
      return start.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
    }
    return `${start.toLocaleDateString("en-US", { month: "short" })} - ${end.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
  }

  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Align day start to the slot grid (pairs with FullCalendar slotDuration). */
function snapSlotStartMinutes(startMins, slotMins) {
  const step = Math.max(1, slotMins);
  return Math.floor(Math.max(0, startMins) / step) * step;
}

/** First slot row at or on/after `targetMins`, stepping from `alignMins` by `stepMins`. */
function firstSlotOnGridAtOrAfter(targetMins, alignMins, stepMins) {
  const step = Math.max(1, stepMins);
  const align = Math.max(0, alignMins);
  const target = Math.max(0, targetMins);
  if (target <= align) return align;
  const delta = target - align;
  return align + Math.ceil(delta / step) * step;
}

/** True when a timed event overlaps [rangeStartMins, rangeEndMins) on the same local day. */
function timedEventOverlapsMinuteRange(event, rangeStartMins, rangeEndMins) {
  if (!event?.start || !event?.end) return false;
  const s = new Date(event.start);
  const en = new Date(event.end);
  const startMins = s.getHours() * 60 + s.getMinutes();
  const endMins = en.getHours() * 60 + en.getMinutes();
  const endDay = en.getDate() !== s.getDate() ? 24 * 60 : endMins;
  return startMins < rangeEndMins && endDay > rangeStartMins;
}

/** FullCalendar slotMinTime / slotMaxTime (day boundary clamp). */
function minutesToFcTimeString(mins) {
  const m = Math.max(0, Math.min(mins, 24 * 60));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

/** Left-axis label for each day-view slot (e.g. 6:00am, 6:30am, 7:00am). */
function formatDayAxisSlotLabel(totalMinsFromMidnight) {
  const capped = Math.max(0, Math.min(totalMinsFromMidnight, 24 * 60 - 1));
  const h24 = Math.floor(capped / 60);
  const m = capped % 60;
  const hour12 = h24 % 12 || 12;
  const ampm = h24 >= 12 ? "pm" : "am";
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatLocalDateKey(dateInput) {
  const date = new Date(dateInput);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function deriveInstructors(appointments) {
  const seen = {};
  let colorIdx = 0;
  appointments.forEach((appt) => {
    const id = String(appt.teacherID?._id || appt.teacherID || "");
    const name = appt.teacherID?.name || "";
    if (id && id !== "undefined" && !seen[id]) {
      const parts = name.trim().split(/\s+/);
      const initials =
        parts.length >= 2
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : (name.slice(0, 2) || "??").toUpperCase();
      seen[id] = {
        key: id,
        initials,
        name,
        color: CALENDAR_PALETTE[colorIdx % CALENDAR_PALETTE.length],
      };
      colorIdx += 1;
    }
  });
  return Object.values(seen);
}

function buildColorMap(instructors) {
  const map = {};
  instructors.forEach((inst) => {
    map[inst.key] = inst.color;
  });
  return map;
}

// If an event has no explicit terminal status and its end time is in the past,
// treat it as visually "completed" without writing to the backend.
function deriveEffectiveStatus(appt) {
  const explicit = appt.status;
  if (explicit && explicit !== "scheduled") return explicit;
  // An unallocated lesson is deliberately held back from completion, on the
  // server (calendarEvent.scheduler.js) and here. Showing a past one as
  // "completed" would hide the very thing staff have to act on: a delivered
  // lesson that no package has paid for.
  if (appt.allocation?.status === "unallocated") return explicit || "scheduled";
  if (appt.endDateTime && new Date(appt.endDateTime) < new Date()) return "completed";
  return explicit || "scheduled";
}

function transformAppointments(appointments, colorMap, memberSelections = {}, membershipCoverageSet = new Set(), studioTz = null) {
  // Track session order per (customerID + package reference) for all package
  // billing types. A "package" charge is booked against either a CustomerPackage
  // (charge.customerPackageID — the direct-purchase path, tried first below at
  // sessionsRemaining resolution) or an Enrollment (charge.enrollmentID — the
  // curriculum-enrollment path); either identifies the same kind of credit pool,
  // so both are accepted here. Key: `${customerId}::${packageRefId}::${serviceCode}`,
  // value: sorted array of appointment IDs by date. Used to figure out each
  // session's chronological position so we can decide which sessions are
  // covered by the credits paid so far.
  const pkgSessionOrder = {};

  appointments.forEach((appt) => {
    const pkgCharge = Array.isArray(appt.charges) ? appt.charges.find((c) => c.method === "package") : null;
    if (!pkgCharge) return;
    const packageRefId = String(
      pkgCharge.customerPackageID?._id ?? pkgCharge.customerPackageID ??
      pkgCharge.enrollmentID?._id ?? pkgCharge.enrollmentID ?? "",
    );
    if (!packageRefId) return;
    // Order sessions per service: a package's private-lesson credits are tracked
    // separately from its group-class (or any other) service lines.
    const serviceCode = pkgCharge.serviceCode ?? "";
    const customerIds = Array.isArray(appt.customerIDs)
      ? appt.customerIDs.map((c) => String(c._id ?? c))
      : [];
    customerIds.forEach((cid) => {
      const key = `${cid}::${packageRefId}::${serviceCode}`;
      if (!pkgSessionOrder[key]) pkgSessionOrder[key] = [];
      pkgSessionOrder[key].push({
        id: String(appt._id),
        date: new Date(appt.startDateTime),
        sessionNumber:
          typeof pkgCharge.sessionNumber === "number"
            ? pkgCharge.sessionNumber
            : null,
      });
    });
  });

  // Sort each group chronologically
  Object.values(pkgSessionOrder).forEach((arr) => arr.sort((a, b) => a.date - b.date));

  // Credit pools whose stamped session numbers cannot be right, so their
  // ordering is recovered from the calendar (chronological) order instead —
  // which is what the stamps were meant to express.
  //
  //  1. Two events in the pool claim the same position. Bookings made before
  //     the backend took its position from the same atomic operation as the
  //     session deduction could observe each other's increments, and a batch
  //     of slots booked together came back sharing one number — five lessons
  //     reading "5 Paid" instead of counting down.
  //  2. The stamps disagree with chronological order. The backend numbers a
  //     session from `sessionsUsed` at booking time, i.e. the order the staff
  //     member created the bookings — so booking five slots newest-first
  //     leaves the earliest lesson stamped #5. `arr` is already sorted by
  //     date, so its stamps must be non-decreasing or the pool is unreliable.
  const untrustedPools = new Set();
  Object.entries(pkgSessionOrder).forEach(([key, arr]) => {
    const stamped = arr.map((e) => e.sessionNumber).filter((n) => n != null);
    if (new Set(stamped).size !== stamped.length) {
      untrustedPools.add(key);
      return;
    }
    for (let i = 1; i < stamped.length; i++) {
      if (stamped[i] < stamped[i - 1]) {
        untrustedPools.add(key);
        return;
      }
    }
  });

  return appointments.map((appt) => {
    const teacherId = String(
      appt.teacherID?._id || appt.teacherID || "unknown",
    );
    const teacherName = appt.teacherID?.name || "";
    // A to-do assigned to several teachers carries teacherIDs; it should appear in
    // each of their day-view columns. tutorKey stays the primary teacher (week view
    // / filters); teacherKeys lists every column this event belongs in.
    const teacherKeys =
      Array.isArray(appt.teacherIDs) && appt.teacherIDs.length
        ? appt.teacherIDs.map((t) => String(t?._id ?? t))
        : [teacherId];
    const color =
      appt.color ||
      appt.calendarServiceID?.color ||
      colorMap[teacherId] ||
      appt.lessonID?.color ||
      CALENDAR_PALETTE[0];

    const start = studioTz
      ? toStudioLocalDate(new Date(appt.startDateTime), studioTz)
      : new Date(appt.startDateTime);
    const end = studioTz
      ? toStudioLocalDate(new Date(appt.endDateTime), studioTz)
      : new Date(appt.endDateTime);
    const isAllDay = Boolean(appt.allDay);
    const effectiveStatus = deriveEffectiveStatus(appt);
    const isCancelled = effectiveStatus === "cancelled";
    const isCompleted = effectiveStatus === "completed";

    const apptId = String(appt._id || appt.id);
    // Persisted member attendance (backend stores memberIDs as Customer.members subdoc ids,
    // and populates customerIDs[].members so we can resolve them to names here).
    const persistedMemberIds = new Set(
      (Array.isArray(appt.memberIDs) ? appt.memberIDs : []).map((m) => String(m?._id ?? m)),
    );
    // Optimistic fallback: { customerId: [memberName, ...] } captured at selection time,
    // used for the brief window before the refetch returns the persisted memberIDs.
    const refMembers = memberSelections[apptId] || {};
    const customerNames = Array.isArray(appt.customerIDs)
      ? appt.customerIDs
          .map((c) => {
            if (typeof c !== "object") return ""
            const base = c.name || c.email || ""
            const persistedNames = (c.members || [])
              .filter((m) => persistedMemberIds.has(String(m._id)))
              .map((m) => m.name)
              .filter(Boolean)
            const memberNames =
              persistedNames.length > 0 ? persistedNames : refMembers[String(c._id)] || []
            return memberNames.length > 0 ? `${base} & ${memberNames.join(", ")}` : base
          })
          .filter(Boolean)
      : [];

    const serviceCode = appt.calendarServiceID?.serviceCode || "";

    // Find sessions remaining from the first package/enrollment charge record
    let sessionsRemaining = null;
    let totalSessions = null;
    let sessionsPaidFor = null;
    let pkgFullyPaid = false;
    if (Array.isArray(appt.charges) && appt.charges.length > 0) {
      // Membership session-type charges
      const memCharge = appt.charges.find((c) => c.method === "membership" && c.accessType === "sessions");
      if (memCharge?.customerMembershipID) {
        const cm = memCharge.customerMembershipID;
        const cmSvc = (cm.services || []).find((s) => s.serviceCode === serviceCode);
        if (cmSvc) {
          sessionsRemaining = cmSvc.sessionsRemaining ?? null;
          totalSessions = (cmSvc.sessionsUsed ?? 0) + (cmSvc.sessionsRemaining ?? 0);
        }
      }

      const pkgCharge = appt.charges.find((c) => c.method === "package");
      if (pkgCharge) {
        const billingType = appt.packageBillingType ?? null;
        const enrollmentPkg = pkgCharge?.enrollmentID?.package ?? null;
        // Where the money actually lives: an enrollment's package, or the package
        // itself on a direct purchase. Same resolution deriveEventPaid uses on the
        // customer's Lessons tab, so the two screens agree about one booking.
        const billingPkg = enrollmentPkg ?? pkgCharge?.customerPackageID ?? null;
        const amountCollected = billingPkg?.amountCollected ?? 0;
        const totalPaid = billingPkg?.totalPaid ?? 0;
        pkgFullyPaid =
          billingPkg?.paymentStatus === "paid" ||
          (amountCollected > 0 && amountCollected >= totalPaid);

        // Positive evidence that the package has NOT been settled — an explicit
        // non-paid status, or (when the backend sent none) a collected figure short
        // of the price. Missing data leaves the "settled at purchase" assumption
        // alone rather than flipping every one-time booking to Unpaid; a $0 package
        // has nothing to settle and stays paid.
        const packageUnderpaid = billingPkg?.paymentStatus
          ? billingPkg.paymentStatus !== "paid"
          : totalPaid > 0 && amountCollected < totalPaid;

        // A service is "free" when non-chargeable or fully discounted — it has no
        // credits, only sessions, and must be excluded from the paid-credit math.
        const isFreeSvc = (s) =>
          s.isChargeable === false || Number(s.finalAmount || 0) <= 0;

        const resolveSessionsPaidFor = (svc, services) => {
          if (isFreeSvc(svc)) return null;
          const sessTotal = (svc.sessionsUsed ?? 0) + (svc.sessionsRemaining ?? 0);
          const bt = billingType ?? enrollmentPkg?.billingType;
          // A one-time / pay-per-session package is settled at purchase, so every
          // session it holds is a paid credit — but only while it really is settled.
          // Once it is partly collected or refunded it accrues credits from the money
          // actually taken, exactly like an installment package. Without this, an
          // enrollment showing $300 collected of $4350 with $4050 refunded still
          // reported all 30 of its bookings as "Paid" on the calendar.
          if (bt !== "flexible" && bt !== "payment_plan" && !packageUnderpaid) {
            return sessTotal;
          }
          // Mirror the customer-profile calc: split the collected amount across
          // paid (non-free) services by their share of the package price, then
          // convert this service's share to sessions at its post-discount price.
          const grossOf = (s) =>
            ((s.sessionsUsed ?? 0) + (s.sessionsRemaining ?? 0)) *
            Number(s.pricePerSession || 0);
          const chargeablePriceTotal = (services ?? []).reduce(
            (sum, s) => sum + (isFreeSvc(s) ? 0 : grossOf(s)),
            0,
          );
          const svcShare =
            chargeablePriceTotal > 0 ? grossOf(svc) / chargeablePriceTotal : 1;
          const svcAmountPaid = amountCollected * svcShare;
          const effectivePps =
            sessTotal > 0 && Number(svc.finalAmount) > 0
              ? Number(svc.finalAmount) / sessTotal
              : Number(svc.pricePerSession || 0);
          if (effectivePps <= 0) return null;
          return svcAmountPaid / effectivePps;
        };

        // Try customerPackageID first
        if (pkgCharge?.customerPackageID?.services) {
          const pkg = pkgCharge.customerPackageID;
          const svc = pkg.services.find((s) => s.serviceCode === pkgCharge.serviceCode) ?? pkg.services.find((s) => (s.pricePerSession ?? 0) > 0);
          if (svc) {
            sessionsRemaining = svc.sessionsRemaining ?? null;
            totalSessions = (svc.sessionsUsed ?? 0) + (svc.sessionsRemaining ?? 0);
            sessionsPaidFor = resolveSessionsPaidFor(svc, pkg.services);
          }
        }
        // Fall back to enrollmentID
        if (sessionsRemaining === null && enrollmentPkg?.services) {
          const svc = enrollmentPkg.services.find((s) => s.serviceCode === pkgCharge.serviceCode) ?? enrollmentPkg.services.find((s) => (s.pricePerSession ?? 0) > 0);
          if (svc) {
            sessionsRemaining = svc.sessionsRemaining ?? null;
            totalSessions = (svc.sessionsUsed ?? 0) + (svc.sessionsRemaining ?? 0);
            sessionsPaidFor = resolveSessionsPaidFor(svc, enrollmentPkg.services);
          }
        }
      }
    }

    // "Already used" per the package's own aggregate (sessionsUsed vs
    // sessionsRemaining). The backend increments sessionsUsed synchronously
    // the moment a session is *booked* against the package (see
    // calendarEvent.controller.js's charge-application step) — not when it's
    // attended — so for a normal package this count is already fully
    // explained by the real bookings sitting in pkgSessionOrder below. It only
    // has "invisible" extra beyond that for a migrated package's baseline
    // usage (imported with no CalendarEvent behind it) or bookings outside
    // this fetch's date range.
    const sessionsBeforeFromHistory = totalSessions != null && sessionsRemaining != null ? totalSessions - sessionsRemaining : 0;

    // Determine this event's chronological session number within its enrollment.
    let pkgSessionNumber = null;
    {
      const pkgCharge2 = Array.isArray(appt.charges) ? appt.charges.find((c) => c.method === "package") : null;
      if (pkgCharge2) {
        // Must match the packageRefId resolution used to build pkgSessionOrder
        // above — customerPackageID (direct-purchase) or enrollmentID
        // (curriculum-enrollment), whichever this charge carries.
        const packageRefId2 = String(
          pkgCharge2.customerPackageID?._id ?? pkgCharge2.customerPackageID ??
          pkgCharge2.enrollmentID?._id ?? pkgCharge2.enrollmentID ?? "",
        );
        const serviceCode2 = pkgCharge2.serviceCode ?? "";
        const customerIds2 = Array.isArray(appt.customerIDs) ? appt.customerIDs.map((c) => String(c._id ?? c)) : [];
        // Duplicate stamps anywhere in this pool mean none of them can be
        // trusted to order it — see untrustedPools above.
        const poolIsTrusted = !customerIds2.some((cid) =>
          untrustedPools.has(`${cid}::${packageRefId2}::${serviceCode2}`),
        );

        // The backend stamps each package-funded charge with its true position
        // in the credit pool at booking time (baseline sessionsUsed + this
        // occurrence's own share — see computeSessionBaselines in
        // calendarEvent.controller.js). That's authoritative and immune to
        // this fetch's date window, unlike the client-side fallback below —
        // prefer it whenever it's present and its pool is self-consistent.
        if (typeof pkgCharge2.sessionNumber === "number" && poolIsTrusted) {
          pkgSessionNumber = pkgCharge2.sessionNumber;
        } else {
          // Fallback for events booked before the backend started stamping
          // sessionNumber: derive it from chronological order among whatever
          // sibling bookings happen to be loaded in the current fetch. This is
          // only as good as that fetch's date window — a package whose
          // bookings span further than it (e.g. a long recurring series) can
          // make this undercount, since it can't tell "not visible" apart from
          // "didn't happen yet".
          for (const cid of customerIds2) {
            const key = `${cid}::${packageRefId2}::${serviceCode2}`;
            const order = pkgSessionOrder[key];
            if (order) {
              const idx = order.findIndex((e) => e.id === String(appt._id));
              if (idx >= 0) {
                // sessionsBeforeFromHistory in excess of what `order` itself
                // accounts for is the genuinely invisible portion (see comment
                // above) — that's the only part that should stack on top of this
                // event's own position in the list. When `order` already
                // explains all of it (the common case: every booking for this
                // key loaded in this fetch), nothing is added and each sibling
                // gets its own increasing position instead of collapsing onto
                // one shared floor.
                const invisiblePriorUsage = Math.max(0, sessionsBeforeFromHistory - order.length);
                pkgSessionNumber = invisiblePriorUsage + idx + 1;
                break;
              }
            }
          }
        }
      }
    }

    // Credits available for this specific session = sessions paid for minus the
    // sessions that come chronologically before it. pkgSessionNumber above
    // already folds in any invisible prior usage, so it's used as-is when
    // resolved; sessionsBeforeFromHistory is only the fallback for an event
    // whose package charge/order couldn't be matched at all. A session is
    // "paid" once it has at least ~one full credit (≥ 0.9, allowing for
    // rounding). This unifies every billing type: a settled one-time/upfront
    // package pays for all sessions at purchase (full credits), while flexible/
    // payment-plan — and any package left partly collected or refunded — accrue
    // credits from the money actually taken.
    const sessionsBefore =
      pkgSessionNumber != null ? pkgSessionNumber - 1 : sessionsBeforeFromHistory;
    const coveredByCredits = sessionsPaidFor != null && sessionsPaidFor - sessionsBefore >= 0.999;
    // A package charge whose service is free/non-chargeable has nothing to pay.
    const freePackageService =
      appt.chargeMethod === "package" && sessionsRemaining != null && sessionsPaidFor == null;

    // Check if any customer on this event is covered by an active membership for this service
    const coveredByMembership =
      appt.chargeMethod === "membership" ||
      (appt.chargeMethod === "none" &&
        serviceCode &&
        Array.isArray(appt.customerIDs) &&
        appt.customerIDs.some((c) =>
          membershipCoverageSet.has(`${String(c._id ?? c)}::${serviceCode}`)
        ));

    // Coarse "paid" signals that don't look at this session's own credit:
    // an explicit payment on the event, a non-installment package (one-time /
    // pay-per-session — settled at purchase), a fully-paid enrollment, or a
    // non-package charge method that always settles up front.
    const paidByCoarseSignal =
      appt.payment?.collected ||
      (appt.chargeMethod === "package" &&
        appt.packageBillingType !== "flexible" &&
        appt.packageBillingType !== "payment_plan") ||
      pkgFullyPaid ||
      appt.chargeMethod === "credits" ||
      appt.chargeMethod === "direct" ||
      appt.chargeMethod === "mixed" ||
      coveredByMembership;

    // When we could resolve the package's credit data, whether THIS session is
    // covered by a purchased/paid credit is authoritative and vetoes the coarse
    // signals above: a one-time (or fully-paid) package that's been booked past
    // the number of sessions it actually paid for must not read as "Paid" just
    // because of its billing type. An explicit payment recorded on the event
    // still counts (e.g. the extra session was paid for separately).
    const packageCreditDataResolved =
      appt.chargeMethod === "package" &&
      (sessionsPaidFor != null || sessionsRemaining != null);
    const _isActuallyPaid = packageCreditDataResolved
      ? coveredByCredits || freePackageService || Boolean(appt.payment?.collected)
      : paidByCoarseSignal || coveredByCredits || freePackageService;
    const paymentCollected = _isActuallyPaid ? "paid" : "unpaid";

    return {
      id: String(appt._id || appt.id),
      title: appt.title || "Event",
      start,
      end,
      _utcStart: appt.startDateTime,
      _utcEnd: appt.endDateTime,
      _studioTz: studioTz || null,
      allDay: isAllDay,
      backgroundColor: isAllDay ? "var(--studio-primary)" : "transparent",
      borderColor: "transparent",
      textColor: isAllDay ? "rgb(var(--studio-on-primary-rgb))" : "inherit",
      extendedProps: {
        tutorName: teacherName,
        tutorKey: teacherId,
        teacherKeys,
        // To-dos (created from the To-Do catalog, stored as type "event") render
        // with a distinct task treatment rather than the lesson/booking block.
        isTodo: Boolean(appt.todoID) || appt.type === "event",
        status: appt.status,
        effectiveStatus,
        // Booked with no program to pay for it — flagged on the chip so it is
        // visible at a glance rather than only inside the detail panel.
        isUnallocated: appt.allocation?.status === "unallocated",
        color: isCancelled ? "hsl(var(--muted-foreground))" : isCompleted ? color : color,
        customerNames,
        eventType: appt.type,
        publicNote: appt.notes,
        serviceCode,
        sessionsRemaining,
        totalSessions,
        sessionsPaidFor,
        pkgSessionNumber,
        paymentCollected,
        coveredByMembership,
        studentCount: Array.isArray(appt.customerIDs) ? appt.customerIDs.length : 0,
        // Studio timezone for correct time display regardless of browser timezone.
        _studioTz: studioTz || null,
        // Inject effectiveStatus into raw so EventDetailPanel sees the correct status
        raw: { ...appt, effectiveStatus },
      },
    };
  });
}

function SegmentedButton({ active, children, className, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 px-3 text-[11px] leading-none select-none bg-background border border-border transition-colors",
        active
          ? "font-bold text-foreground"
          : "font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50",
        className,
      )}
      style={{ boxShadow: COLORS.shadow }}
    >
      {children}
    </button>
  );
}

function IconCircleButton({ children, ariaLabel, onClick }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="h-8 w-8 rounded-full bg-background border border-border grid place-items-center hover:bg-muted/50 transition-colors"
      style={{ boxShadow: COLORS.shadow }}
    >
      {children}
    </button>
  );
}

function SmallRoundedButton({ children, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-8 rounded-[20px] px-3 border text-[11px] font-bold transition-colors",
        active
          ? "border-[var(--studio-primary)] bg-[color-mix(in_srgb,var(--studio-primary)_12%,transparent)] text-[var(--studio-primary)]"
          : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      ].join(" ")}
      style={{ boxShadow: COLORS.shadow }}
    >
      {children}
    </button>
  );
}

/** True while a native time input inside `root` is focused (picker UI lives outside the DOM subtree). */
function isNativeTimePickerActive(rootRef) {
  const ae = document.activeElement;
  return (
    ae instanceof HTMLInputElement &&
    ae.type === "time" &&
    Boolean(rootRef.current?.contains(ae))
  );
}

/** Close when any scrollable ancestor scrolls (e.g. layout main); keep open if scroll is inside the dropdown root. */
function useCloseOnOuterScroll(open, setOpen, rootRef) {
  useEffect(() => {
    if (!open) return;
    const onScroll = (e) => {
      const t = e.target;
      if (t instanceof Node && rootRef.current?.contains(t)) return;
      if (isNativeTimePickerActive(rootRef)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open, setOpen, rootRef]);
}

/** Like View Options: pointerdown outside closes. Skips when native `type="time"` picker is open (clicks hit outside the root). */
function useCloseOnClickOutside(open, setOpen, rootRef) {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      const path =
        typeof e.composedPath === "function" && e.composedPath().length > 0
          ? e.composedPath()
          : [e.target];
      const inside = path.some(
        (n) => n instanceof Node && rootRef.current && rootRef.current.contains(n),
      );
      if (inside) return;
      if (isNativeTimePickerActive(rootRef)) return;
      setOpen(false);
    };
    // pointerdown covers mouse + touch; avoid closing on the same gesture that opened
    const id = window.setTimeout(() => {
      document.addEventListener("pointerdown", handler);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", handler);
    };
  }, [open, setOpen, rootRef]);
}

const WEEKDAY_LABELS_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function buildMonthPickerCells(viewMonth) {
  const month = viewMonth.getMonth();
  const start = startOfWeekSunday(new Date(viewMonth.getFullYear(), month, 1));
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i);
    return { date, inMonth: date.getMonth() === month };
  });
}

function CalendarDatePicker({ focusDate, label, onSelectDate }) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(
    () => new Date(focusDate.getFullYear(), focusDate.getMonth(), 1),
  );
  const ref = useRef(null);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  useCloseOnOuterScroll(open, setOpen, ref);
  useCloseOnClickOutside(open, setOpen, ref);

  useEffect(() => {
    if (open) {
      setViewMonth(new Date(focusDate.getFullYear(), focusDate.getMonth(), 1));
    }
  }, [open, focusDate]);

  const cells = useMemo(() => buildMonthPickerCells(viewMonth), [viewMonth]);

  const monthTitle = viewMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const shiftMonth = (delta) => {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  return (
    <div ref={ref} className="relative min-w-0 max-w-[min(100%,220px)] sm:min-w-[160px] sm:max-w-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg text-[13px] font-semibold transition-colors",
          open
            ? "text-[var(--studio-primary)] bg-[color-mix(in_srgb,var(--studio-primary)_12%,transparent)]"
            : "text-foreground hover:bg-muted/50",
        ].join(" ")}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Pick a date"
      >
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose day"
          className="absolute left-1/2 -translate-x-1/2 top-[calc(100%+6px)] z-50 w-[252px] rounded-xl border border-border bg-popover p-3 shadow-lg"
        >
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
              className="h-7 w-7 rounded-lg border border-border grid place-items-center hover:bg-muted/60 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <span className="text-[12px] font-bold text-foreground">{monthTitle}</span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
              className="h-7 w-7 rounded-lg border border-border grid place-items-center hover:bg-muted/60 transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAY_LABELS_SHORT.map((wd) => (
              <div
                key={wd}
                className="text-center text-[9px] font-semibold text-muted-foreground py-0.5"
              >
                {wd}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map(({ date, inMonth }) => {
              const selected = isSameDate(date, focusDate);
              const isToday = isSameDate(date, today);
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  onClick={() => {
                    onSelectDate(new Date(date));
                    setOpen(false);
                  }}
                  className={[
                    "h-8 w-full rounded-md text-[11px] font-medium transition-colors",
                    !inMonth && "text-muted-foreground/40",
                    inMonth && !selected && "text-foreground hover:bg-muted/60",
                    selected &&
                      "bg-[var(--studio-primary)] text-[rgb(var(--studio-on-primary-rgb))] font-bold",
                    isToday &&
                      !selected &&
                      "ring-1 ring-[var(--studio-primary)] ring-inset",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              onSelectDate(new Date());
              setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              setOpen(false);
            }}
            className="mt-2 w-full py-1.5 text-[11px] font-semibold text-[var(--studio-primary)] hover:bg-muted/50 rounded-lg transition-colors"
          >
            Today
          </button>
        </div>
      )}
    </div>
  );
}

function ViewOptionsDropdown({ hideEmptySlots, setHideEmptySlots, goToToday, compact = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const hasActive = hideEmptySlots;

  useCloseOnOuterScroll(open, setOpen, ref);
  useCloseOnClickOutside(open, setOpen, ref);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "h-8 rounded-[20px] px-2.5 sm:px-3 border text-[11px] font-bold transition-colors flex items-center gap-1.5",
          hasActive
            ? "border-[var(--studio-primary)] bg-[color-mix(in_srgb,var(--studio-primary)_12%,transparent)] text-[var(--studio-primary)]"
            : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        ].join(" ")}
        style={{ boxShadow: COLORS.shadow }}
      >
        {compact ? "Options" : "View Options"}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-[60] min-w-[160px] rounded-xl border border-border bg-popover shadow-lg py-1.5">
          <button
            type="button"
            onClick={() => { goToToday(); setOpen(false); }}
            className="w-full px-4 py-2 text-left text-[12px] font-medium text-foreground hover:bg-muted/60 transition-colors"
          >
            Today
          </button>
          <div className="h-px bg-border mx-2 my-1" />
          <button
            type="button"
            onClick={() => setHideEmptySlots((v) => !v)}
            className="w-full px-4 py-2 text-left text-[12px] font-medium flex items-center justify-between hover:bg-muted/60 transition-colors"
          >
            <span className={hideEmptySlots ? "text-[var(--studio-primary)]" : "text-foreground"}>Hide Empty</span>
            {hideEmptySlots && <span className="h-1.5 w-1.5 rounded-full bg-[var(--studio-primary)]" />}
          </button>
        </div>
      )}
    </div>
  );
}

const EVENT_TYPE_LABEL = {
  private: "Appt",
  lesson:  "Group",
  trial:   "Trial",
  event:   "To Do",
  record:  "Record",
};

const STATUS_STYLES = {
  scheduled: { bg: "bg-info/10", text: "text-info", label: "Scheduled" },
  completed: { bg: "bg-success/10", text: "text-success", label: "Completed" },
  cancelled:          { bg: "bg-muted", text: "text-muted-foreground", label: "Cancelled" },
  no_show:            { bg: "bg-warning/10", text: "text-warning", label: "No Show" },
  cancelled_no_charge:{ bg: "bg-muted", text: "text-muted-foreground", label: "Cancelled" },
  cancelled_charged: { bg: "bg-destructive/10", text: "text-destructive", label: "Cancelled – Charged" },
  no_show_no_charge:  { bg: "bg-warning/10", text: "text-warning", label: "No Show" },
  no_show_charged:    { bg: "bg-warning/20", text: "text-warning", label: "No Show – Charged" },
};

function PaymentStatusBadge({ collected }) {
  const cfg = {
    paid: { cls: "bg-success/20 text-success", label: "Paid" },
    unpaid: { cls: "bg-destructive/10 text-destructive", label: "Unpaid" },
  };
  const { cls, label } = cfg[collected] ?? cfg.unpaid;
  return (
    <span className={`shrink-0 text-[8px] font-semibold rounded px-1 py-0.5 leading-none ${cls}`}>
      {label}
    </span>
  );
}

function TypeBadge({ type }) {
  if (!type) return null;
  const label = EVENT_TYPE_LABEL[type] ?? type;
  return (
    <span className="shrink-0 rounded px-1 py-px text-[8px] font-bold uppercase leading-none bg-black/10 text-foreground/70">
      {label}
    </span>
  );
}

// Only the exceptional states earn a chip badge: "Scheduled" and "Completed" are
// what almost every lesson is, so badging them buries the one that isn't.
function StatusBadge({ status }) {
  if (!status || status === "scheduled" || status === "completed") return null;
  const s = STATUS_STYLES[status];
  if (!s) return null;
  return (
    <span className={`shrink-0 rounded px-1 py-px text-[8px] font-semibold leading-none ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ─── List (Agenda) View ───────────────────────────────────────────────────────

function formatListDayLabel(date) {
  const today    = new Date();
  const tomorrow = addDays(today, 1);
  if (isSameDate(date, today))    return "Today";
  if (isSameDate(date, tomorrow)) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function ListEventRow({ event, onEventClick }) {
  const { color, tutorName, customerNames, eventType, status, raw } =
    event.extendedProps || {};
  const accentColor   = color || "var(--studio-primary)";
  const isCancelled   = status === "cancelled";
  const typeLabel     = EVENT_TYPE_LABEL[eventType] ?? eventType ?? "";
  const statusStyle   = STATUS_STYLES[status];

  const studioTz = event._studioTz || event.extendedProps?._studioTz || null;
  const utcStart = event._utcStart || raw?.startDateTime || null;
  const utcEnd   = event._utcEnd   || raw?.endDateTime   || null;

  const fmt = (d) =>
    d
      ? new Date(d).toLocaleTimeString("en-US", {
          ...(studioTz ? { timeZone: studioTz } : {}),
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "";

  const startLabel = fmt(utcStart || event.start);
  const endLabel   = fmt(utcEnd   || event.end);
  const durationMins =
    event.end && event.start
      ? (new Date(event.end) - new Date(event.start)) / 60000
      : 0;
  const durationLabel = (() => {
    if (!durationMins) return "";
    if (durationMins < 60) return `${durationMins}m`;
    const h = Math.floor(durationMins / 60);
    const m = durationMins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  })();

  const initials = (tutorName || "")
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const customers =
    Array.isArray(customerNames) && customerNames.length > 0
      ? customerNames.join(", ")
      : null;

  return (
    <button
      type="button"
      onClick={() => raw && onEventClick?.(raw)}
      className={`w-full text-left group flex flex-col sm:flex-row items-stretch gap-0 rounded-xl border border-border bg-card hover:bg-muted/40 transition-colors overflow-hidden ${isCancelled ? "opacity-60" : ""}`}
    >
      {/* Accent left bar — desktop/tablet side; on mobile use top strip via border */}
      <div className="hidden sm:block w-1 shrink-0" style={{ backgroundColor: accentColor }} />
      <div className="sm:hidden h-1 w-full shrink-0" style={{ backgroundColor: accentColor }} />

      {/* Time column */}
      <div className="w-full sm:w-28 shrink-0 flex flex-row sm:flex-col items-center sm:items-start justify-between sm:justify-center gap-2 px-3 py-2.5 sm:py-3 border-b sm:border-b-0 sm:border-r border-border">
        {event.allDay ? (
          <span className="text-[11px] font-semibold text-muted-foreground">All day</span>
        ) : (
          <>
            <span className="text-[12px] font-bold text-foreground leading-tight">{startLabel}</span>
            <span className="text-[10px] text-muted-foreground leading-tight">{endLabel}</span>
            {durationLabel && (
              <span className="sm:mt-0.5 text-[10px] text-muted-foreground/70 leading-tight">{durationLabel}</span>
            )}
          </>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col justify-center px-3 sm:px-4 py-2.5 sm:py-3 gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[13px] font-semibold text-foreground leading-tight ${
              isCancelled ? "line-through text-muted-foreground" : ""
            }`}
          >
            {event.title}
          </span>
          {typeLabel && (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider leading-none"
              style={{
                backgroundColor: `color-mix(in srgb, ${accentColor} 18%, transparent)`,
                color: accentColor,
              }}
            >
              {typeLabel}
            </span>
          )}
          {statusStyle && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider leading-none ${statusStyle.bg} ${statusStyle.text}`}
            >
              {statusStyle.label}
            </span>
          )}
        </div>
        {customers && (
          <div className="text-[11px] text-muted-foreground leading-tight truncate">
            {customers}
          </div>
        )}
      </div>

      {/* Teacher column */}
      {tutorName && (
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-3 border-t sm:border-t-0 sm:border-l border-border shrink-0">
          <span
            className="h-6 w-6 rounded-full text-[9px] font-bold grid place-items-center text-white shrink-0"
            style={{ backgroundColor: accentColor }}
          >
            {initials}
          </span>
          <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap truncate max-w-[140px] sm:max-w-none">
            {tutorName}
          </span>
        </div>
      )}
    </button>
  );
}

function ListCalendarView({ events, focusDate, onEventClick }) {
  const [showEmpty, setShowEmpty] = useState(false);

  const days = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => addDays(focusDate, i));
  }, [focusDate]);

  const grouped = useMemo(() => {
    return days.map((day) => ({
      day,
      events: events
        .filter((e) => isSameDate(new Date(e.start), day))
        .sort((a, b) => new Date(a.start) - new Date(b.start) || new Date(a.end) - new Date(b.end)),
    }));
  }, [events, days]);

  const totalEvents = grouped.reduce((sum, g) => sum + g.events.length, 0);
  const daysWithEvents = grouped.filter((g) => g.events.length > 0).length;
  const visibleGroups = showEmpty ? grouped : grouped.filter((g) => g.events.length > 0);

  return (
    <div className="flex flex-col overflow-hidden rounded-[12px] border border-border bg-background">
      {/* List header bar */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 sm:px-5 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-[12px] font-semibold text-foreground">
            {totalEvents} event{totalEvents !== 1 ? "s" : ""}
          </span>
          <span className="text-[11px] text-muted-foreground">
            across {daysWithEvents} day{daysWithEvents !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowEmpty((v) => !v)}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0 whitespace-nowrap"
        >
          {showEmpty ? "Hide empty days" : "Show empty days"}
        </button>
      </div>

      <div className="divide-y divide-border">
          {visibleGroups.map(({ day, events: dayEvents }) => {
            const isToday = isSameDate(day, new Date());
            const isPast  = day < new Date() && !isToday;
            return (
              <div key={day.toISOString()} className={isPast ? "opacity-55" : ""}>
                <div
                  className={`sticky top-0 z-10 flex items-center gap-3 px-3 sm:px-5 py-2 border-b border-border/60 ${
                    isToday
                      ? "bg-[color-mix(in_srgb,var(--studio-primary)_8%,hsl(var(--background)))]"
                      : "bg-background/95 backdrop-blur-sm"
                  }`}
                >
                  <div
                    className={`flex items-center justify-center h-7 w-7 rounded-full text-[12px] font-bold shrink-0 ${
                      isToday ? "bg-[var(--studio-primary)] text-white" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {day.getDate()}
                  </div>
                  <span className={`text-[12px] font-semibold ${isToday ? "text-[var(--studio-primary)]" : "text-foreground"}`}>
                    {formatListDayLabel(day)}
                  </span>
                  {dayEvents.length > 0 && (
                    <span className="ml-auto text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {dayEvents.length}
                    </span>
                  )}
                </div>

                {dayEvents.length > 0 ? (
                  <div className="flex flex-col gap-2 px-3 sm:px-4 py-3">
                    {dayEvents.map((event) => (
                      <ListEventRow key={event.id} event={event} onEventClick={onEventClick} />
                    ))}
                  </div>
                ) : (
                  <div className="px-3 sm:px-5 py-3 text-[11px] text-muted-foreground/40 italic">
                    No events scheduled
                  </div>
                )}
              </div>
            );
          })}

          {visibleGroups.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-2xl">📅</div>
              <p className="text-[13px] font-semibold text-foreground">No events in this period</p>
              <p className="text-[11px] text-muted-foreground">Try navigating to a different date range</p>
            </div>
          )}
        </div>
    </div>
  );
}

// ─── Event Tooltip ────────────────────────────────────────────────────────────

let _tooltipEl = null;

function getTooltipEl() {
  if (!_tooltipEl) {
    _tooltipEl = document.createElement("div");
    _tooltipEl.id = "cal-event-tooltip";
    _tooltipEl.style.cssText = `
      position: fixed;
      z-index: 9999;
      pointer-events: none;
      background: hsl(var(--popover));
      border: 1px solid hsl(var(--border));
      border-radius: 10px;
      padding: 10px 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      min-width: 240px;
      max-width: 300px;
      font-size: 11px;
      color: hsl(var(--foreground));
      display: none;
      line-height: 1.5;
    `;
    document.body.appendChild(_tooltipEl);
  }
  return _tooltipEl;
}

function showGroupEventTooltip(e, props, raw) {
  const tip = getTooltipEl();

  const teacher = raw.teacherID?.name || props.tutorName || "";
  const svc = raw.calendarServiceID || {};
  const serviceName = svc.serviceName || props.serviceCode || "";
  const serviceCode = svc.serviceCode || props.serviceCode || "";
  const servicePrice = svc.price > 0 ? `$${svc.price.toFixed(2)}/session` : null;

  const customers = Array.isArray(raw.customerIDs)
    ? raw.customerIDs.filter((c) => typeof c === "object")
    : [];
  const charges = Array.isArray(raw.charges) ? raw.charges : [];
  const memberIds = new Set(
    (raw.memberIDs || []).map((m) => String(m?._id ?? m)),
  );

  const status = props.effectiveStatus || raw.status || "scheduled";
  const statusColors = {
    scheduled: "#3b82f6", completed: "#22c55e",
    cancelled_no_charge: "#6b7280", cancelled_charged: "#ef4444",
    no_show_no_charge: "#f97316", no_show_charged: "#f97316",
  };
  const statusColor = statusColors[status] || "#6b7280";
  const statusLabel = status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  const divider = `<div style="border-top:1px solid hsl(var(--border));margin:6px 0"></div>`;
  const section = (label, value) =>
    value ? `<div style="display:flex;justify-content:space-between;gap:12px;margin:2px 0">
      <span style="color:hsl(var(--muted-foreground));white-space:nowrap">${label}</span>
      <span style="font-weight:600;text-align:right">${value}</span>
    </div>` : "";

  const renderStudent = (c) => {
    const cid = String(c._id);
    const charge = charges.find((ch) => String(ch.customerID) === cid);
    const attending = (c.members || [])
      .filter((m) => memberIds.has(String(m._id)))
      .map((m) => m.name)
      .filter(Boolean);
    const name = (c.name || c.email || "—") +
      (attending.length ? ` <span style="opacity:.6">& ${attending.join(", ")}</span>` : "");

    let credits = "";
    const svcEntry = (() => {
      if (charge?.method === "package") {
        const code = charge.serviceCode || serviceCode;
        const services =
          charge.customerPackageID?.services ||
          charge.enrollmentID?.package?.services;
        if (services) {
          return (
            services.find((s) => s.serviceCode === code) ??
            services.find((s) => (s.pricePerSession ?? 0) > 0)
          );
        }
      }
      if (charge?.method === "membership" && charge.customerMembershipID?.services) {
        const code = charge.serviceCode || serviceCode;
        return charge.customerMembershipID.services.find((s) => s.serviceCode === code);
      }
      return null;
    })();
    if (svcEntry?.sessionsRemaining != null) {
      const r = svcEntry.sessionsRemaining;
      credits = `<span style="color:${r <= 1 ? "#ef4444" : "#22c55e"};font-size:10px">${r} left</span>`;
    }

    const paid = Boolean(charge);
    const methodLabel = charge
      ? charge.method === "package" ? "Package"
        : charge.method === "membership" ? "Membership"
        : charge.method === "credits" ? "Credits"
        : charge.method === "direct" ? "Direct"
        : "Paid"
      : null;
    const dot = paid ? "#22c55e" : "#ef4444";

    return `<div style="display:flex;align-items:center;gap:6px;margin:3px 0">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dot};flex-shrink:0"></span>
      <span style="font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>
      ${credits}
      <span style="color:hsl(var(--muted-foreground));font-size:10px;white-space:nowrap">${methodLabel || "Unpaid"}</span>
    </div>`;
  };

  const html = `
    <div style="font-weight:700;font-size:12px;margin-bottom:2px">${raw.title || "Group Class"}</div>
    <div style="color:hsl(var(--muted-foreground));font-size:10px;margin-bottom:6px">${serviceName}${serviceCode && serviceCode !== serviceName ? ` (${serviceCode})` : ""}</div>
    ${divider}
    ${section("Instructor", teacher)}
    ${section("Price", servicePrice)}
    ${divider}
    <div style="color:hsl(var(--muted-foreground));margin-bottom:2px">Students (${customers.length})</div>
    ${customers.length ? customers.map(renderStudent).join("") : `<div style="color:hsl(var(--muted-foreground));font-size:10px">No students enrolled</div>`}
    ${divider}
    <div style="display:flex;align-items:center;gap:6px;margin:2px 0">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${statusColor};flex-shrink:0"></span>
      <span style="font-weight:600">${statusLabel}</span>
    </div>
  `;

  tip.innerHTML = html;
  tip.style.display = "block";
  positionTooltip(e);
}

function showTodoTooltip(e, props, raw) {
  const tip = getTooltipEl();

  const teacherNames =
    Array.isArray(raw.teacherIDs) && raw.teacherIDs.length
      ? raw.teacherIDs.map((t) => t?.name).filter(Boolean)
      : props.tutorName
        ? [props.tutorName]
        : [];

  const fmt = (d) =>
    d
      ? new Date(d).toLocaleTimeString("en-US", {
          ...(props._studioTz ? { timeZone: props._studioTz } : {}),
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "";
  const timeRange = raw.startDateTime
    ? `${fmt(raw.startDateTime)} – ${fmt(raw.endDateTime)}`
    : "";

  const status = props.effectiveStatus || raw.status || "scheduled";
  const statusColors = {
    scheduled: "#3b82f6",
    completed: "#22c55e",
    cancelled_no_charge: "#6b7280",
    cancelled_charged: "#ef4444",
    no_show_no_charge: "#f97316",
    no_show_charged: "#f97316",
  };
  const statusColor = statusColors[status] || "#6b7280";
  const statusLabel = status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  const divider = `<div style="border-top:1px solid hsl(var(--border));margin:6px 0"></div>`;
  const section = (label, value) =>
    value
      ? `<div style="display:flex;justify-content:space-between;gap:12px;margin:2px 0">
      <span style="color:hsl(var(--muted-foreground));white-space:nowrap">${label}</span>
      <span style="font-weight:600;text-align:right">${value}</span>
    </div>`
      : "";

  tip.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:12px;margin-bottom:2px">
      <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${props.color || "var(--studio-primary)"};flex-shrink:0"></span>
      ${raw.title || "To-do"}
      <span style="color:hsl(var(--muted-foreground));font-weight:600;font-size:10px">· To-do</span>
    </div>
    ${divider}
    ${section(teacherNames.length > 1 ? "Assigned to" : "Assigned", teacherNames.join(", "))}
    ${section("When", timeRange)}
    ${divider}
    <div style="display:flex;align-items:center;gap:6px;margin:2px 0">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${statusColor};flex-shrink:0"></span>
      <span style="font-weight:600">${statusLabel}</span>
    </div>
  `;

  tip.style.display = "block";
  positionTooltip(e);
}

function showEventTooltip(e, props) {
  const tip = getTooltipEl();
  const raw = props.raw || {};

  // Group classes get their own roster-style tooltip.
  if (props.eventType === "lesson") {
    showGroupEventTooltip(e, props, raw);
    return;
  }

  // To-dos are staff tasks — no customer, service, or payment. Show the task,
  // who it's assigned to, when, and its status.
  if (props.isTodo) {
    showTodoTooltip(e, props, raw);
    return;
  }

  // ── Customer ──────────────────────────────────────────────────────────────
  const customerObjs = Array.isArray(raw.customerIDs)
    ? raw.customerIDs.filter((c) => typeof c === "object")
    : [];
  // Use the already member-filtered names from extendedProps instead of recomputing from raw
  const customerNames = Array.isArray(props.customerNames) && props.customerNames.length > 0
    ? props.customerNames
    : customerObjs.map((c) => c.name || c.email || "").filter(Boolean);
  const customerEmails = customerObjs.map((c) => c.email).filter(Boolean);

  // ── Teacher ───────────────────────────────────────────────────────────────
  const teacher = raw.teacherID?.name || props.tutorName || "";

  // ── Service ───────────────────────────────────────────────────────────────
  const svc = raw.calendarServiceID || {};
  const serviceName = svc.serviceName || props.serviceCode || "";
  const serviceCode = svc.serviceCode || props.serviceCode || "";
  const servicePrice = svc.price > 0 ? `$${svc.price.toFixed(2)}/session` : null;

  // ── Package & sessions ────────────────────────────────────────────────────
  const pkgCharge = Array.isArray(raw.charges)
    ? raw.charges.find((c) => c.method === "package")
    : null;
  const memCharge = Array.isArray(raw.charges)
    ? raw.charges.find((c) => c.method === "membership" && c.accessType === "sessions")
    : null;

  // Try to resolve package name from charge's customerPackageID or enrollmentID
  let packageName = null;
  let packageExpiry = null;
  let sessionsRemaining = props.sessionsRemaining ?? null;
  let totalSessions = props.totalSessions ?? null;

  // Membership session-type charges
  if (memCharge?.customerMembershipID) {
    const cm = memCharge.customerMembershipID;
    const cmSvc = (cm.services || []).find((s) => s.serviceCode === serviceCode);
    if (cmSvc) {
      sessionsRemaining = cmSvc.sessionsRemaining ?? sessionsRemaining;
      totalSessions = (cmSvc.sessionsUsed ?? 0) + (cmSvc.sessionsRemaining ?? 0) || totalSessions;
      packageName = cm.membershipName || "Membership";
    }
  }

  if (pkgCharge) {
    const cpkg = pkgCharge.customerPackageID;
    if (cpkg) {
      const svcEntry = Array.isArray(cpkg.services)
        ? cpkg.services.find((s) => s.serviceCode === serviceCode)
        : null;
      if (svcEntry) {
        sessionsRemaining = svcEntry.sessionsRemaining ?? sessionsRemaining;
        totalSessions = (svcEntry.sessionsUsed ?? 0) + (svcEntry.sessionsRemaining ?? 0) || totalSessions;
      }
      packageName = cpkg.packageName || "Package";
      if (cpkg.expiryDate) packageExpiry = new Date(cpkg.expiryDate).toLocaleDateString("en-AU");
    }
    // Fall back to enrollmentID if customerPackageID didn't resolve sessions
    if (sessionsRemaining === null && pkgCharge?.enrollmentID?.package?.services) {
      const svcEntry = pkgCharge.enrollmentID.package.services.find(
        (s) => s.serviceCode === serviceCode,
      );
      if (svcEntry) {
        sessionsRemaining = svcEntry.sessionsRemaining ?? sessionsRemaining;
        totalSessions = (svcEntry.sessionsUsed ?? 0) + (svcEntry.sessionsRemaining ?? 0) || totalSessions;
      }
    }
  }

  // ── Status & payment ──────────────────────────────────────────────────────
  const status = props.effectiveStatus || raw.status || "scheduled";
  const statusColors = {
    scheduled: "#3b82f6", completed: "#22c55e",
    cancelled_no_charge: "#6b7280", cancelled_charged: "#ef4444",
    no_show_no_charge: "#f97316", no_show_charged: "#f97316",
  };
  const statusColor = statusColors[status] || "#6b7280";
  const statusLabel = status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  const chargeMethod = raw.chargeMethod;
  const packageBillingType = raw.packageBillingType;
  const paymentLabel = chargeMethod === "package"
    ? packageBillingType === "pay_per_session"
      ? "Per session · Package"
      : "Package"
    : chargeMethod === "credits"
    ? "Charged from credits"
    : chargeMethod === "direct"
    ? "Direct payment"
    : raw.payment?.collected
    ? `Collected (${raw.payment.method || ""})`
    : null;

  // Prefer the per-session "paid" verdict computed in transformAppointments
  // (credit-aware — an over-booked package session reads as unpaid); fall back
  // to the coarse method check only when it wasn't provided.
  const isPaid =
    props.paymentCollected != null
      ? props.paymentCollected === "paid"
      : (chargeMethod === "package" && raw.packageBillingType !== "flexible") ||
        chargeMethod === "credits" ||
        chargeMethod === "direct" ||
        chargeMethod === "mixed" ||
        chargeMethod === "membership" ||
        raw.payment?.collected;
  const paymentStatus = isPaid ? "Paid" : "Unpaid";
  const paymentStatusColor = isPaid ? "#22c55e" : "#ef4444";

  const divider = `<div style="border-top:1px solid hsl(var(--border));margin:6px 0"></div>`;

  const section = (label, value) =>
    value ? `<div style="display:flex;justify-content:space-between;gap:12px;margin:2px 0">
      <span style="color:hsl(var(--muted-foreground));white-space:nowrap">${label}</span>
      <span style="font-weight:600;text-align:right">${value}</span>
    </div>` : "";

  const html = `
    <div style="font-weight:700;font-size:12px;margin-bottom:2px">${customerNames.join(", ") || "Unknown"}</div>
    ${customerEmails.length ? `<div style="color:hsl(var(--muted-foreground));font-size:10px;margin-bottom:6px">${customerEmails.join(", ")}</div>` : ""}
    ${divider}
    ${section("Instructor", teacher)}
    ${section("Service", serviceName + (serviceCode && serviceCode !== serviceName ? ` <span style="opacity:.6">(${serviceCode})</span>` : ""))}
    ${section("Price", servicePrice)}
    ${divider}
    ${packageName ? section("Package", packageName) : ""}
    ${packageExpiry ? section("Expires", packageExpiry) : ""}
    ${sessionsRemaining != null && totalSessions != null ? (() => {
      const sessionsPaidForTooltip = props.sessionsPaidFor ?? totalSessions;
      const sessionsUsedTooltip = totalSessions - sessionsRemaining;
      // Match the booking rule (a session is covered at >= 0.999 credits) so the
      // tooltip never disagrees with what can actually be scheduled.
      const schedulableTooltip = Math.max(0, Math.floor(sessionsPaidForTooltip + 0.001) - sessionsUsedTooltip);
      return section("Credits", `<span style="color:${schedulableTooltip <= 1 ? "#ef4444" : "#22c55e"}">${schedulableTooltip} schedulable</span> <span style="opacity:.6">(${sessionsRemaining}/${totalSessions} remaining)</span>`);
    })() : ""}
    ${divider}
    <div style="display:flex;align-items:center;gap:6px;margin:2px 0">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${statusColor};flex-shrink:0"></span>
      <span style="font-weight:600">${statusLabel}</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${paymentStatusColor};flex-shrink:0"></span>
      <span style="font-weight:600;color:${paymentStatusColor}">${paymentStatus}</span>
      ${paymentLabel ? `<span style="color:hsl(var(--muted-foreground));font-size:10px">· ${paymentLabel}</span>` : ""}
    </div>
  `;

  tip.innerHTML = html;
  tip.style.display = "block";
  positionTooltip(e);
}

function positionTooltip(e) {
  const tip = getTooltipEl();
  const pad = 12;
  const tw = tip.offsetWidth || 220;
  const th = tip.offsetHeight || 120;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + tw > window.innerWidth - pad) x = e.clientX - tw - pad;
  if (y + th > window.innerHeight - pad) y = e.clientY - th - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function hideEventTooltip() {
  const tip = getTooltipEl();
  tip.style.display = "none";
}

/** Timed event card: title/customer, teacher, time, sessions, Paid/Unpaid, group student count. */
function AppointmentTimedEventRows({ event, compact = false }) {
  const ep = event.extendedProps || {};
  const {
    tutorName,
    effectiveStatus,
    customerNames,
    eventType,
    serviceCode,
    sessionsRemaining,
    totalSessions,
    sessionsPaidFor,
    pkgSessionNumber,
    paymentCollected,
    coveredByMembership,
    studentCount: studentCountProp,
    isTodo,
    isUnallocated,
  } = ep;
  const cancelled =
    effectiveStatus === "cancelled" ||
    effectiveStatus === "cancelled_no_charge" ||
    effectiveStatus === "cancelled_charged";

  const isGroupClass = eventType === "lesson";
  const durationMins = getEventDurationMins(event) || 0;

  // _studioTz and _utcStart/_utcEnd may be on the top-level event (custom view)
  // or only in extendedProps (FullCalendar's info.event strips custom top-level props).
  const studioTz = event._studioTz || ep._studioTz || null;
  const utcStart = event._utcStart || ep.raw?.startDateTime || null;
  const utcEnd   = event._utcEnd   || ep.raw?.endDateTime   || null;

  const fmt = (d) =>
    d
      ? new Date(d).toLocaleTimeString("en-US", {
          ...(studioTz ? { timeZone: studioTz } : {}),
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "";

  const startLabel = fmt(utcStart || event.start);
  const endLabel = fmt(utcEnd || event.end);
  const timeRange =
    startLabel && endLabel ? `${startLabel} – ${endLabel}` : startLabel;

  const durationLabel = (() => {
    if (!durationMins) return "";
    if (durationMins < 60) return `${Math.round(durationMins)}m`;
    const h = Math.floor(durationMins / 60);
    const m = Math.round(durationMins % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  })();

  const firstCustomer =
    Array.isArray(customerNames) && customerNames.length > 0
      ? customerNames[0]
      : null;

  // A to-do's column already identifies the teacher, so the secondary line is
  // dropped rather than repeating the (primary) teacher's name in every column.
  const teacherLine = isTodo ? "" : [serviceCode, tutorName].filter(Boolean).join(" — ");

  const studentCount =
    studentCountProp ??
    (Array.isArray(customerNames) ? customerNames.length : 0) ??
    (Array.isArray(ep.raw?.customerIDs) ? ep.raw.customerIDs.length : 0);

  const sessionsLabel = (() => {
    if (sessionsRemaining == null || totalSessions == null) return null;
    // Same blind spot as the "Paid" badge/credit-check fix above:
    // pkgSessionNumber only sees sessions with a real calendar-event/charge
    // history, so `totalSessions - pkgSessionNumber` overstates what's left
    // whenever a migrated package's imported baseline usage has no such
    // history behind it (this is the "11/12 left" that should read "7/12").
    // When we know this event's chronological position in the package
    // (pkgSessionNumber), show the balance *as of this session* — one credit
    // gone per session, counting down in booking order (45 → 44 → 43 …), so it
    // tracks the "X Paid" badge beside it session-for-session. Only fall back to
    // the stored aggregate when the position is unknown.
    const remaining = pkgSessionNumber != null
      ? Math.max(0, totalSessions - pkgSessionNumber)
      : sessionsRemaining;
    return `${remaining}/${totalSessions}`;
  })();

  const primaryLabel = isTodo
    ? event.title || "To-do"
    : isGroupClass
      ? event.title || "Group class"
      : firstCustomer;

  return (
    <div className="h-full min-h-0 flex flex-col gap-px overflow-hidden">
      {primaryLabel && (
        <div
          className={`text-[10px] font-bold text-foreground leading-tight truncate shrink-0 ${cancelled ? "line-through text-muted-foreground" : ""}`}
        >
          {primaryLabel}
        </div>
      )}
      {teacherLine && (
        <div className="text-[9px] text-foreground/80 leading-tight truncate shrink-0 font-medium">
          {teacherLine}
        </div>
      )}
      {(timeRange || durationLabel) && (
        <div className="text-[9px] text-muted-foreground leading-tight truncate shrink-0">
          {timeRange}
          {timeRange && durationLabel ? ` (${durationLabel})` : durationLabel}
        </div>
      )}
      {!isTodo && (
      <div
        className={`flex items-center gap-1 shrink-0 mt-auto min-w-0 pt-px ${compact ? "flex-nowrap overflow-hidden pr-[54px]" : "flex-wrap"}`}
      >
        <StatusBadge status={effectiveStatus} />
        {isUnallocated && (
          <span
            className="shrink-0 inline-flex items-center text-[8px] font-semibold rounded px-1 py-0.5 leading-none bg-warning/25 text-warning"
            title="Not allocated to a package — nothing has paid for this lesson"
          >
            Unallocated
          </span>
        )}
        <PaymentStatusBadge collected={paymentCollected} />
        {coveredByMembership && (
          <span className="shrink-0 inline-flex items-center gap-0.5 text-[8px] font-semibold rounded px-1 py-0.5 leading-none bg-violet-500/20 text-violet-700 dark:text-violet-300">
            Membership
            {sessionsRemaining == null && <span className="text-[10px] leading-none">∞</span>}
          </span>
        )}
        {isGroupClass && (
          <span className="shrink-0 text-[8px] font-semibold text-foreground/80 bg-black/10 dark:bg-white/10 rounded px-1 py-0.5 leading-none">
            {studentCount} student{studentCount === 1 ? "" : "s"}
          </span>
        )}
        {!isGroupClass && sessionsPaidFor != null && (() => {
          // Show credit balance as it was just after this session's own
          // credit was consumed — pkgSessionNumber (from transformAppointments)
          // is already this event's 1-based position in booking order, with
          // any invisible prior usage (a migrated package's baseline usage
          // with no calendar event behind it, or bookings outside the current
          // fetch) folded in, so it's used as-is here instead of being
          // reclamped against totalSessions-sessionsRemaining — that floor is
          // already part of pkgSessionNumber, and re-applying it here as a
          // separate max() flattened every sibling in the same batch onto one
          // shared number instead of decrementing per session. The +1 accounts
          // for this session's own credit — the very first session in the
          // whole package (sessionsBefore = 0) shows sessionsPaidFor - 1, not
          // sessionsPaidFor, since booking it already spent one.
          const sessionsBefore =
            pkgSessionNumber != null
              ? pkgSessionNumber - 1
              : (totalSessions != null && sessionsRemaining != null ? totalSessions - sessionsRemaining : 0);
          const net = sessionsPaidFor - (sessionsBefore + 1);
          // When credits run out, show the fractional remainder (e.g. 0.3) so the
          // customer can see what they still have — don't collapse to 0.
          const raw = net >= 0 ? net : sessionsPaidFor % 1;
          // Snap near-integers (float dust), otherwise truncate — never round a
          // partially-paid session up to a full, schedulable-looking credit.
          const display =
            Math.abs(raw - Math.round(raw)) < 0.001
              ? Math.round(raw)
              : Math.floor(raw * 100) / 100;
          return (
            <span className="shrink-0 text-[8px] font-semibold text-foreground/70 bg-black/10 dark:bg-white/10 rounded px-1 py-0.5 leading-none">
              {display} Paid
            </span>
          );
        })()}
        {!isGroupClass && sessionsLabel && (
          <span className="shrink-0 text-[8px] font-semibold text-foreground/70 bg-black/10 dark:bg-white/10 rounded px-1 py-0.5 leading-none">
            {sessionsLabel} left
          </span>
        )}
      </div>
      )}
    </div>
  );
}


function renderEventContent(info) {
  const { effectiveStatus, color } = info.event.extendedProps || {};
  const cancelled = effectiveStatus === "cancelled_no_charge" || effectiveStatus === "cancelled_charged";
  const completed = effectiveStatus === "completed";
  const accentColor = color || "var(--studio-primary)";

  if (info.event.allDay) {
    return (
      <div
        className="h-full w-full px-2 py-0.5 flex items-center rounded text-[10px] font-semibold truncate"
        style={{
          backgroundColor: "var(--studio-primary)",
          color: "rgb(var(--studio-on-primary-rgb))",
        }}
      >
        {info.event.title}
      </div>
    );
  }

  return (
    <div
      className={`${BOOKING_CARD_SHELL_CLASS} relative ${cancelled ? "opacity-50" : ""} ${completed ? "opacity-80" : ""}`}
      style={{
        borderLeft: `3px solid ${accentColor}`,
        backgroundColor: `color-mix(in srgb, ${accentColor} 28%, hsl(var(--card)))`,
      }}
    >
      {completed && (
        <span
          className="absolute top-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-success flex items-center justify-center z-10 shrink-0"
          title="Completed"
        >
          <svg viewBox="0 0 10 10" className="h-2 w-2 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1.5,5 4,7.5 8.5,2.5" />
          </svg>
        </span>
      )}
      <div className="h-full min-h-0 flex flex-col overflow-hidden px-1.5 py-0.5 gap-[1px] box-border">
        <AppointmentTimedEventRows event={info.event} />
      </div>
    </div>
  );
}

function formatHourLabel(hour24) {
  if (hour24 === 0) return "12 AM";
  if (hour24 < 12) return `${hour24} AM`;
  if (hour24 === 12) return "12 PM";
  return `${hour24 - 12} PM`;
}

function formatTime(dateInput) {
  const date = new Date(dateInput);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function isCancelledEventStatus(status) {
  return status === "cancelled_no_charge" || status === "cancelled_charged";
}

function layoutOverlappingEvents(events) {
  const sorted = [...events].sort((a, b) => {
    const startDiff = new Date(a.start) - new Date(b.start);
    if (startDiff !== 0) return startDiff;
    const endDiff = new Date(a.end) - new Date(b.end);
    if (endDiff !== 0) return endDiff;
    const aCancelled = isCancelledEventStatus(a.extendedProps?.effectiveStatus);
    const bCancelled = isCancelledEventStatus(b.extendedProps?.effectiveStatus);
    if (aCancelled !== bCancelled) return aCancelled ? 1 : -1;
    return 0;
  });
  const active = [];
  const laidOut = [];
  let maxLanes = 1;

  sorted.forEach((event) => {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);
    for (let i = active.length - 1; i >= 0; i--) {
      if (new Date(active[i].end) <= eventStart) active.splice(i, 1);
    }

    const isCancelled = isCancelledEventStatus(
      event.extendedProps?.effectiveStatus,
    );
    const sameSlotLiveEvent = isCancelled
      ? active.find(
          (e) =>
            !isCancelledEventStatus(e.extendedProps?.effectiveStatus) &&
            new Date(e.start).getTime() === eventStart.getTime() &&
            new Date(e.end).getTime() === eventEnd.getTime(),
        )
      : null;

    let lane;
    if (sameSlotLiveEvent) {
      lane = sameSlotLiveEvent.lane;
    } else {
      const used = new Set(active.map((e) => e.lane));
      lane = 0;
      while (used.has(lane)) lane += 1;
    }

    const withLane = {
      ...event,
      lane,
      isPeekingBehind: Boolean(sameSlotLiveEvent),
    };
    active.push(withLane);
    laidOut.push(withLane);
    if (!sameSlotLiveEvent) {
      maxLanes = Math.max(maxLanes, active.length, lane + 1);
    }
  });

  return laidOut.map((event) => ({ ...event, totalLanes: maxLanes }));
}

function getEventStartMinsSinceMidnight(event) {
  const s = new Date(event.start);
  return s.getHours() * 60 + s.getMinutes();
}

/** Week grid slot by start time (e.g. all 9:00 AM sessions share one slot). */
function getEventTimeSlotKey(event) {
  return String(getEventStartMinsSinceMidnight(event));
}

function computeGridTopForStartMins(
  startMins,
  { gridPadTop, dayStartMins, gridStartMins, customSlotMins, slotRowHeightPx },
) {
  const displayStartMins = Math.max(startMins, gridStartMins);
  return (
    gridPadTop +
    ((displayStartMins - dayStartMins) / customSlotMins) * slotRowHeightPx
  );
}

/**
 * Week day column: same start-time slot (e.g. 9:00) → 1 card + "+N more" (all instructors).
 * Different start times stay separate on the grid.
 */
function layoutWeekDayTimedEvents(events, gridLayout) {
  const cardH = TIMED_EVENT_CARD_DISPLAY_HEIGHT_PX;
  const gap = TIMED_EVENT_CARD_STACK_GAP_PX;

  const buckets = new Map();
  for (const event of events) {
    const bucketKey = getEventTimeSlotKey(event);
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey).push(event);
  }

  const units = Array.from(buckets.entries())
    .map(([bucketKey, bucketEvents]) => {
      const sorted = [...bucketEvents].sort(
        (a, b) =>
          new Date(a.start) - new Date(b.start) ||
          String(a.id).localeCompare(String(b.id)),
      );
      return {
        bucketKey,
        events: sorted,
        startMins: getEventStartMinsSinceMidnight(sorted[0]),
        collapse: sorted.length > 1,
      };
    })
    .sort((a, b) => a.startMins - b.startMins);

  const visible = [];

  units.forEach((unit) => {
    const anchorTop = computeGridTopForStartMins(unit.startMins, gridLayout);

    if (!unit.collapse) {
      visible.push({ ...unit.events[0], top: anchorTop });
      return;
    }

    const sortedCluster = [...unit.events].sort(
      (a, b) =>
        new Date(a.start) - new Date(b.start) ||
        String(a.id).localeCompare(String(b.id)),
    );
    const show = sortedCluster.slice(0, WEEK_SAME_SLOT_MAX_VISIBLE);
    const hidden = sortedCluster.slice(WEEK_SAME_SLOT_MAX_VISIBLE);

    show.forEach((event, lane) => {
      const item = { ...event, top: anchorTop + lane * (cardH + gap) };
      if (lane === 0 && hidden.length > 0) {
        item.slotOverflow = {
          count: hidden.length,
          allEvents: sortedCluster,
          bucketKey: unit.bucketKey,
        };
      }
      visible.push(item);
    });
  });

  return { visible };
}

/** Derive the {date, time, instructorId} slot payload `onSlotClick` expects
 * from an existing calendar event — used to let a cancelled event's own card
 * offer "Book over" instead of making the user re-locate its empty slot. */
function slotInfoForEvent(event, instructorId) {
  const s = new Date(event.start);
  return {
    date: formatLocalDateKey(s),
    time: `${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`,
    instructorId,
  };
}

function TimedCalendarEventCard({
  event,
  top,
  onEventClick,
  onBookOverClick,
  slotOverflow,
  onSlotMoreClick,
  customSlotMins = DEFAULT_SLOT_MINS,
  slotRowHeightPx = TIME_SLOT_ROW_MIN_HEIGHT_PX,
}) {
  const accentColor = event.extendedProps?.color || "var(--studio-primary)";
  const effectiveStatus = event.extendedProps?.effectiveStatus;
  const isCancelledEvent =
    effectiveStatus === "cancelled_no_charge" ||
    effectiveStatus === "cancelled_charged";
  const isCompletedEvent = effectiveStatus === "completed";
  // Sized to the event's own duration — same px-per-minute rate as the time
  // grid — instead of one fixed height for every card regardless of length.
  const durationMins = getEventDurationMins(event) || customSlotMins;
  const height = Math.max(
    TIMED_EVENT_CARD_MIN_HEIGHT_PX,
    (durationMins / customSlotMins) * slotRowHeightPx,
  );

  return (
    <div
      data-event="true"
      data-week-event-card="true"
      onClick={(e) => {
        if (e.target.closest("[data-slot-more]")) return;
        e.stopPropagation();
        onEventClick?.(event.extendedProps?.raw);
      }}
      className={`absolute cursor-pointer transition-all duration-150 group/event ${BOOKING_CARD_SHELL_CLASS} ${
        isCancelledEvent ? "opacity-50" : ""
      } ${isCompletedEvent ? "opacity-80" : ""}`}
      style={{
        top,
        height,
        maxHeight: height,
        minHeight: height,
        left: "2px",
        width: "calc(100% - 4px)",
        borderLeft: `3px solid ${accentColor}`,
        backgroundColor: `color-mix(in srgb, ${accentColor} 28%, hsl(var(--card)))`,
        boxShadow: "0 1px 3px hsl(var(--foreground)/0.06)",
        zIndex: 10,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `0 4px 12px ${accentColor}40`;
        e.currentTarget.style.zIndex = "20";
        e.currentTarget.style.backgroundColor = `color-mix(in srgb, ${accentColor} 38%, hsl(var(--card)))`;
        e.currentTarget.style.transform = "scaleX(1.01)";
        showEventTooltip(e, event.extendedProps || {});
      }}
      onMouseMove={(e) => positionTooltip(e)}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 3px hsl(var(--foreground)/0.06)";
        e.currentTarget.style.zIndex = "10";
        e.currentTarget.style.backgroundColor = `color-mix(in srgb, ${accentColor} 28%, hsl(var(--card)))`;
        e.currentTarget.style.transform = "scaleX(1)";
        hideEventTooltip();
      }}
    >
      {isCompletedEvent && (
        <span
          className="absolute top-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-success flex items-center justify-center z-10 shrink-0"
          title="Completed"
        >
          <svg
            viewBox="0 0 10 10"
            className="h-2 w-2 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="1.5,5 4,7.5 8.5,2.5" />
          </svg>
        </span>
      )}
      {slotOverflow ? (
        <button
          type="button"
          data-slot-more="true"
          title={`View all ${slotOverflow.allEvents?.length ?? slotOverflow.count + 1} sessions at this time`}
          onClick={(e) => {
            e.stopPropagation();
            hideEventTooltip();
            const cardEl = e.currentTarget.closest("[data-week-event-card]");
            onSlotMoreClick?.(e, slotOverflow, cardEl);
          }}
          onMouseEnter={(e) => e.stopPropagation()}
          className="calendar-more-link absolute bottom-0.5 right-0.5 z-20 shrink-0 max-w-[calc(100%-8px)]"
        >
          +{slotOverflow.count} more
        </button>
      ) : null}
      {isCancelledEvent && onBookOverClick ? (
        <button
          type="button"
          data-book-over="true"
          title="Book a new lesson in this freed-up slot"
          onClick={(e) => {
            e.stopPropagation();
            hideEventTooltip();
            onBookOverClick(event);
          }}
          onMouseEnter={(e) => e.stopPropagation()}
          className="calendar-more-link absolute top-0.5 right-0.5 z-20 shrink-0 max-w-[calc(100%-8px)] opacity-0 group-hover/event:opacity-100"
        >
          Book over
        </button>
      ) : null}
      <div className="h-full min-h-0 flex flex-col overflow-hidden px-1.5 py-0.5 gap-[1px] box-border">
        <AppointmentTimedEventRows event={event} compact={Boolean(slotOverflow)} />
      </div>
    </div>
  );
}

/** Place overflow popover to the right of the anchor card; flip left if near viewport edge. */
function computeWeekOverflowPopoverStyle(anchor) {
  const gap = 6;
  const width = anchor.width;
  let left = anchor.right + gap;
  let top = anchor.top;

  if (typeof window !== "undefined") {
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, anchor.left - width - gap);
    }
    const maxTop = window.innerHeight - 120;
    if (top > maxTop) top = Math.max(8, maxTop);
  }

  return { top, left, width };
}

function TimedEventsOverflowPopover({ events, style, onClose, onEventClick }) {
  const ref = useRef(null);
  useCloseOnClickOutside(true, onClose, ref);
  useCloseOnOuterScroll(true, onClose, ref);

  return (
    <div
      ref={ref}
      className="fixed z-[100] max-h-[min(320px,50vh)] overflow-y-auto rounded-lg border border-border bg-popover py-1 px-0 shadow-xl box-border"
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {events.map((event) => {
        const accentColor = event.extendedProps?.color || "var(--studio-primary)";
        const effectiveStatus = event.extendedProps?.effectiveStatus;
        const isCancelledEvent =
          effectiveStatus === "cancelled_no_charge" ||
          effectiveStatus === "cancelled_charged";
        const isCompletedEvent = effectiveStatus === "completed";
        return (
          <button
            key={event.id}
            type="button"
            data-event="true"
            onClick={(e) => {
              e.stopPropagation();
              onEventClick?.(event.extendedProps?.raw);
              onClose();
            }}
            className={`w-full text-left mb-1 last:mb-0 cursor-pointer ${BOOKING_CARD_SHELL_CLASS} ${
              isCancelledEvent ? "opacity-50" : ""
            } ${isCompletedEvent ? "opacity-80" : ""}`}
            style={{
              height: TIMED_EVENT_CARD_DISPLAY_HEIGHT_PX,
              minHeight: TIMED_EVENT_CARD_DISPLAY_HEIGHT_PX,
              maxHeight: TIMED_EVENT_CARD_DISPLAY_HEIGHT_PX,
              width: "100%",
              borderLeft: `3px solid ${accentColor}`,
              backgroundColor: `color-mix(in srgb, ${accentColor} 28%, hsl(var(--card)))`,
              boxShadow: "0 1px 3px hsl(var(--foreground)/0.06)",
            }}
          >
            <div className="h-full min-h-0 flex flex-col overflow-hidden px-1.5 py-0.5 gap-[1px] box-border">
              <AppointmentTimedEventRows event={event} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

const UNASSIGNED_KEY = "__unassigned__";

// Which teacher columns an event belongs to. Multi-teacher to-dos list every
// assignee in teacherKeys; everything else falls back to its single tutorKey.
function eventTutorKeys(event) {
  const keys = event.extendedProps?.teacherKeys;
  if (Array.isArray(keys) && keys.length) return keys;
  return [event.extendedProps?.tutorKey || "unknown"];
}

function eventBelongsToTutor(event, tutorKey) {
  return eventTutorKeys(event).includes(tutorKey);
}

function deriveTutorsFromEvents(events, passedTutors) {
  if (passedTutors.length > 0) return passedTutors;
  const seen = {};
  events.forEach((event) => {
    const key = event.extendedProps?.tutorKey || UNASSIGNED_KEY;
    if (!seen[key]) {
      const name =
        event.extendedProps?.tutorName ||
        (key === UNASSIGNED_KEY ? "Unassigned" : key);
      const parts = name.trim().split(/\s+/);
      const initials =
        parts.length >= 2
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : (name.slice(0, 2) || "??").toUpperCase();
      seen[key] = {
        key,
        name,
        initials,
        color:
          key === UNASSIGNED_KEY
            ? "hsl(var(--muted-foreground))"
            : event.extendedProps?.color || CALENDAR_PALETTE[0],
      };
    }
  });
  return Object.values(seen);
}

function TutorDayCalendar({
  visibleStartMins,
  visibleEndHour,
  visibleGridPhaseMins,
  focusDate,
  now,
  dayTimedEvents,
  dayAllDayEvents,
  tutors,
  allEvents,
  onEventClick,
  onSlotClick,
  onColumnReorder,
  customSlotMins = DEFAULT_SLOT_MINS,
  slotAlignMins = 0,
}) {
  const slotRowHeightPx = TIME_SLOT_ROW_MIN_HEIGHT_PX;
  const gridPhaseMins =
    visibleGridPhaseMins != null ? visibleGridPhaseMins : slotAlignMins;
  const gridStartMins = firstSlotOnGridAtOrAfter(
    visibleStartMins,
    gridPhaseMins,
    customSlotMins,
  );
  const gridEndMins = Math.min(24 * 60, Math.max(0, visibleEndHour) * 60);
  const totalMins = Math.max(0, gridEndMins - gridStartMins);
  const slotsCount = Math.max(0, Math.floor(totalMins / customSlotMins));
  const dayHeight = Math.max(slotRowHeightPx, slotsCount * slotRowHeightPx);
  /** Push first slot below sticky header overlap (labels use -translate-y-1/2 on the top line). */
  const gridPadTop = Math.max(12, Math.ceil(slotRowHeightPx / 2));
  const paddedDayHeight = dayHeight + gridPadTop;

  // `tutors` is the active-teacher list — an event assigned to no one, or to
  // a non-teacher user (e.g. a task assigned to an admin via the "Assign
  // to" picker on New Task), resolves to a tutorKey ("unknown", or that
  // admin's user id) that never matches any teacher column, so it would
  // otherwise render nowhere in day view even though month view shows it
  // fine (month view has no per-column filtering at all). Give every such
  // orphaned event a synthetic "Unassigned" column instead of silently
  // dropping it.
  const effectiveTutors = useMemo(() => {
    const knownKeys = new Set(tutors.map((t) => t.key));
    const orphanNames = new Map(); // key -> best-known display name
    [...dayTimedEvents, ...dayAllDayEvents].forEach((event) => {
      eventTutorKeys(event).forEach((key) => {
        if (knownKeys.has(key) || orphanNames.has(key)) return;
        orphanNames.set(key, event.extendedProps?.tutorName || "Unassigned");
      });
    });
    if (!orphanNames.size) return tutors;
    const orphanTutors = Array.from(orphanNames, ([key, name]) => ({
      key,
      name,
      initials: name === "Unassigned" ? "UN" : (name.slice(0, 2) || "??").toUpperCase(),
      color: "hsl(var(--muted-foreground))",
    }));
    return [...tutors, ...orphanTutors];
  }, [tutors, dayTimedEvents, dayAllDayEvents]);

  const visibleDayTimedEvents = useMemo(
    () =>
      dayTimedEvents.filter((event) =>
        timedEventOverlapsMinuteRange(event, gridStartMins, gridEndMins),
      ),
    [dayTimedEvents, gridStartMins, gridEndMins],
  );

  const byTutorTimed = useMemo(() => {
    const map = {};
    effectiveTutors.forEach((tutor) => {
      const filtered = visibleDayTimedEvents.filter((event) =>
        eventBelongsToTutor(event, tutor.key),
      );
      map[tutor.key] = layoutOverlappingEvents(filtered);
    });
    return map;
  }, [visibleDayTimedEvents, effectiveTutors]);

  const byTutorAllDay = useMemo(() => {
    const map = {};
    effectiveTutors.forEach((tutor) => {
      map[tutor.key] = dayAllDayEvents.filter((event) =>
        eventBelongsToTutor(event, tutor.key),
      );
    });
    return map;
  }, [dayAllDayEvents, effectiveTutors]);

  // The "N today · N/wk" badge is meant to reflect real bookings/lessons, so
  // to-dos (extendedProps.isTodo) are excluded from both counts.
  const weekCountByTutor = useMemo(() => {
    const map = {};
    const weekStart = startOfWeekSunday(focusDate);
    const weekEnd = addDays(weekStart, 7);
    allEvents.forEach((event) => {
      if (event.extendedProps?.isTodo) return;
      const d = new Date(event.start);
      if (d >= weekStart && d < weekEnd) {
        const key = event.extendedProps?.tutorKey || "unknown";
        map[key] = (map[key] || 0) + 1;
      }
    });
    return map;
  }, [allEvents, focusDate]);

  const isToday = isSameDate(focusDate, now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const dayStartMins = gridStartMins;
  const nowOffset =
    isToday && nowMinutes >= gridStartMins && nowMinutes <= gridEndMins
      ? gridPadTop +
        ((nowMinutes - gridStartMins) / customSlotMins) * slotRowHeightPx
      : null;

  const focusDateLabel = focusDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const headerScrollRef = useRef(null);
  const bodyScrollRef = useRef(null);
  const draggedColRef = useRef(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  // Columns always stretch to fill the available width (flex-1) and shrink
  // no smaller than MIN_COL_WIDTH — with few tutors they fill the screen;
  // once there isn't room for everyone at the minimum, they hold at
  // MIN_COL_WIDTH and the row scrolls horizontally instead of squeezing
  // thinner. A fixed-width mode used to kick in above 3 tutors, but a fixed
  // total narrower than the screen just left blank space after the last
  // column instead of filling it.
  const MIN_COL_WIDTH = 200;
  const colClass = "flex-1";
  const colWidth = undefined;

  function syncHeaderScroll() {
    if (headerScrollRef.current && bodyScrollRef.current) {
      headerScrollRef.current.scrollLeft = bodyScrollRef.current.scrollLeft;
    }
  }

  return (
    <div className="flex flex-col rounded-[12px] border border-border bg-background shadow-sm">
      <div className="sticky top-0 z-40 rounded-t-[12px] border-b border-border bg-background/95 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-background/80">
        <div className="flex shrink-0 border-b border-border bg-muted/30">
          <div className="w-[86px] shrink-0 border-r border-border flex items-end pb-2 px-2 bg-muted/30 z-10">
            <span className="text-[10px] font-medium text-muted-foreground leading-tight">{focusDateLabel}</span>
          </div>
          <div ref={headerScrollRef} className="flex-1 overflow-x-hidden">
            <div className="flex" style={{ minWidth: effectiveTutors.length * MIN_COL_WIDTH }}>
          {effectiveTutors.map((tutor, idx) => {
            const todayCount =
              dayTimedEvents.filter((e) => !e.extendedProps?.isTodo && eventBelongsToTutor(e, tutor.key))
                .length +
              (byTutorAllDay[tutor.key]?.filter((e) => !e.extendedProps?.isTodo).length ?? 0);
            const weekCount = weekCountByTutor[tutor.key] ?? 0;
            return (
              <div
                key={tutor.key}
                className={`px-3 py-2.5 text-center ${colClass}`}
                style={{
                  minWidth: MIN_COL_WIDTH,
                  ...(colWidth && { width: colWidth }),
                  borderRight:
                    idx < effectiveTutors.length - 1
                      ? "1px solid hsl(var(--border))"
                      : "none",
                  backgroundColor: dragOverCol === tutor.key ? `color-mix(in srgb, ${tutor.color} 18%, hsl(var(--muted)))` : undefined,
                  transition: "background-color 0.15s",
                  cursor: "grab",
                }}
                draggable
                onDragStart={(e) => { draggedColRef.current = tutor.key; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", tutor.key); }}
                onDragEnd={() => { draggedColRef.current = null; setDragOverCol(null); }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDragEnter={(e) => { e.preventDefault(); if (draggedColRef.current && draggedColRef.current !== tutor.key) setDragOverCol(tutor.key); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCol(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCol(null);
                  const fromKey = draggedColRef.current || e.dataTransfer.getData("text/plain");
                  draggedColRef.current = null;
                  if (!fromKey || fromKey === tutor.key) return;
                  const keys = effectiveTutors.map((t) => t.key);
                  const fromIdx = keys.indexOf(fromKey);
                  const toIdx = keys.indexOf(tutor.key);
                  if (fromIdx === -1 || toIdx === -1) return;
                  const reordered = [...keys];
                  reordered.splice(fromIdx, 1);
                  reordered.splice(toIdx, 0, fromKey);
                  onColumnReorder?.(reordered);
                }}
              >
                <div className="flex flex-col items-center min-w-0">
                  <span className="text-[11px] font-semibold text-foreground truncate max-w-full leading-tight">
                    {tutor.name || tutor.label || "Unknown"}
                  </span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span
                      className="text-[10px] font-bold px-1.5 py-px rounded-full"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${tutor.color} 15%, transparent)`,
                        color: tutor.color,
                      }}
                    >
                      {todayCount} today
                    </span>
                    {weekCount > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        · {weekCount}/wk
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
            </div>
          </div>
        </div>

        {/* All-day row (per-tutor all-day events) — hidden for now; uncomment to restore
        <div className="flex h-10 border-b border-border bg-muted/40">
          <div className="w-[86px] shrink-0 border-r border-border px-2 py-2 text-[10px] font-medium text-muted-foreground">
            All day
          </div>
          {effectiveTutors.map((tutor, idx) => (
            <div
              key={`allday-${tutor.key}`}
              className="flex-1 px-1.5 py-1"
              style={{
                borderRight:
                  idx < effectiveTutors.length - 1
                    ? "1px solid hsl(var(--border))"
                    : "none",
              }}
            >
              {(byTutorAllDay[tutor.key] || []).slice(0, 1).map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${event.extendedProps?.color || "var(--studio-primary)"} 28%, hsl(var(--card)))`,
                    borderLeft: `3px solid ${event.extendedProps?.color || "var(--studio-primary)"}`,
                    color:
                      event.extendedProps?.color || "var(--studio-primary)",
                  }}
                >
                  <span className="truncate">{event.title}</span>
                  <TypeBadge type={event.extendedProps?.eventType} />
                </div>
              ))}
            </div>
          ))}
        </div>
        */}
      </div>

      <div className="relative flex">
        <div
          className="relative w-[86px] shrink-0 border-r border-border bg-background z-10"
          style={{ height: paddedDayHeight }}
        >
          {Array.from({ length: slotsCount }).map((_, idx) => {
            const currentMins = dayStartMins + idx * customSlotMins;
            const label = formatDayAxisSlotLabel(currentMins);

            return (
              <div
                key={idx}
                className="absolute left-0 right-0"
                style={{ top: gridPadTop + idx * slotRowHeightPx }}
              >
                <div className="-translate-y-1/2 px-2 text-[10px] font-medium text-muted-foreground whitespace-nowrap">
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        <div
          ref={bodyScrollRef}
          className="flex-1 overflow-x-auto"
          onScroll={syncHeaderScroll}
        >
          <div
            className="relative flex"
            style={{ minWidth: effectiveTutors.length * MIN_COL_WIDTH, height: paddedDayHeight }}
          >
          {effectiveTutors.map((tutor, colIdx) => (
            <div
              key={`${tutor.key}-day-col`}
              className={`relative group/col cursor-pointer overflow-hidden ${colClass}`}
              style={{
                minWidth: MIN_COL_WIDTH,
                ...(colWidth && { width: colWidth }),
                height: paddedDayHeight,
                borderRight:
                  colIdx < effectiveTutors.length - 1
                    ? "1px solid hsl(var(--border))"
                    : "none",
                backgroundColor: `color-mix(in srgb, ${tutor.color} 3%, hsl(var(--background)))`,
              }}
              onClick={(e) => {
                if (e.target.closest("[data-event]")) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const offsetY = e.clientY - rect.top - gridPadTop;
                const rawIdx = Math.floor(Math.max(0, offsetY) / slotRowHeightPx);
                const slotIdx =
                  slotsCount > 0
                    ? Math.min(Math.max(0, rawIdx), slotsCount - 1)
                    : 0;
                const totalSlotMins = dayStartMins + slotIdx * customSlotMins;
                const h = Math.floor(totalSlotMins / 60);
                const m = totalSlotMins % 60;
                onSlotClick?.({
                  date: formatLocalDateKey(focusDate),
                  time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
                  instructorId:
                    tutor.key && tutor.key !== UNASSIGNED_KEY
                      ? tutor.key
                      : undefined,
                });
              }}
            >
              {Array.from({ length: slotsCount }).map((_, idx) => {
                const slotMins = dayStartMins + idx * customSlotMins;
                const isHourBoundary = slotMins % 60 === 0;
                return (
                  <div
                    key={idx}
                    className={`absolute left-0 right-0 ${isHourBoundary ? "border-b border-border/60" : "border-b border-border/20"}`}
                    style={{
                      top: gridPadTop + idx * slotRowHeightPx,
                      height: slotRowHeightPx,
                    }}
                  />
                );
              })}

              {(byTutorTimed[tutor.key] || []).map((event) => {
                const s = new Date(event.start);
                const startMins = s.getHours() * 60 + s.getMinutes();
                const displayStartMins = Math.max(startMins, gridStartMins);

                // Sized to the event's own duration (same px-per-minute rate as
                // the time grid itself: slotRowHeightPx per customSlotMins),
                // instead of every card rendering at one fixed height
                // regardless of whether it's a 20m or 2h booking. Floored so a
                // very short booking still fits its title.
                const durationMins = getEventDurationMins(event) || customSlotMins;
                const height = Math.max(
                  TIMED_EVENT_CARD_MIN_HEIGHT_PX,
                  (durationMins / customSlotMins) * slotRowHeightPx,
                );
                const stackOffset =
                  (event.lane || 0) * (height + TIMED_EVENT_CARD_STACK_GAP_PX);
                const top =
                  gridPadTop +
                  ((displayStartMins - dayStartMins) / customSlotMins) *
                    slotRowHeightPx +
                  stackOffset;

                const accentColor =
                  event.extendedProps?.color || "var(--studio-primary)";
                const effectiveStatus = event.extendedProps?.effectiveStatus;
                const isCancelledEvent = effectiveStatus === "cancelled_no_charge" || effectiveStatus === "cancelled_charged";
                const isCompletedEvent = effectiveStatus === "completed";
                const isTodo = event.extendedProps?.isTodo;

                // To-dos get a task treatment (dashed outline + diagonal hatch, no
                // left stripe) so they never read as a lesson/booking block.
                const baseBg = isTodo
                  ? `color-mix(in srgb, ${accentColor} 12%, hsl(var(--card)))`
                  : `color-mix(in srgb, ${accentColor} 28%, hsl(var(--card)))`;
                const hoverBg = isTodo
                  ? `color-mix(in srgb, ${accentColor} 20%, hsl(var(--card)))`
                  : `color-mix(in srgb, ${accentColor} 38%, hsl(var(--card)))`;
                const hatch = `repeating-linear-gradient(45deg, color-mix(in srgb, ${accentColor} 20%, transparent) 0, color-mix(in srgb, ${accentColor} 20%, transparent) 5px, transparent 5px, transparent 11px)`;
                const shapeStyle = isTodo
                  ? { border: `1.5px dashed ${accentColor}`, backgroundColor: baseBg, backgroundImage: hatch }
                  : { borderLeft: `3px solid ${accentColor}`, backgroundColor: baseBg };
                const peekOffset = event.isPeekingBehind ? 8 : 0;

                return (
                  <div
                    key={event.id}
                    data-event="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick?.(event.extendedProps?.raw);
                    }}
                    className={`absolute cursor-pointer transition-all duration-150 group/event ${BOOKING_CARD_SHELL_CLASS} ${
                      isCancelledEvent ? "opacity-50" : ""
                    } ${isCompletedEvent ? "opacity-80" : ""}`}
                    style={{
                      top: top + peekOffset,
                      height,
                      maxHeight: height,
                      minHeight: height,
                      left: `${2 + peekOffset}px`,
                      width: `calc(100% - ${4 + peekOffset}px)`,
                      ...shapeStyle,
                      boxShadow: "0 1px 3px hsl(var(--foreground)/0.06)",
                      zIndex: isCancelledEvent ? 5 : 10,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = `0 4px 12px ${accentColor}40`;
                      e.currentTarget.style.zIndex = "20";
                      e.currentTarget.style.backgroundColor = hoverBg;
                      e.currentTarget.style.transform = "scaleX(1.01)";
                      showEventTooltip(e, event.extendedProps || {});
                    }}
                    onMouseMove={(e) => positionTooltip(e)}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = "0 1px 3px hsl(var(--foreground)/0.06)";
                      e.currentTarget.style.zIndex = isCancelledEvent ? "5" : "10";
                      e.currentTarget.style.backgroundColor = baseBg;
                      e.currentTarget.style.transform = "scaleX(1)";
                      hideEventTooltip();
                    }}
                  >
                    {isTodo && (
                      <span
                        className="absolute top-0.5 left-0.5 z-10 inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] shrink-0"
                        style={{ backgroundColor: accentColor }}
                        title="To-do"
                      >
                        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1.5,6.2 3.2,8 6,4.4" />
                          <line x1="7.5" y1="4" x2="10.5" y2="4" />
                          <line x1="7.5" y1="7.5" x2="10.5" y2="7.5" />
                        </svg>
                      </span>
                    )}
                    {isCancelledEvent && !event.isPeekingBehind && (
                      <button
                        type="button"
                        data-book-over="true"
                        title="Book a new lesson in this freed-up slot"
                        onClick={(e) => {
                          e.stopPropagation();
                          hideEventTooltip();
                          onSlotClick?.(
                            slotInfoForEvent(
                              event,
                              tutor.key && tutor.key !== UNASSIGNED_KEY
                                ? tutor.key
                                : undefined,
                            ),
                          );
                        }}
                        onMouseEnter={(e) => e.stopPropagation()}
                        className="calendar-more-link absolute top-0.5 right-0.5 z-20 shrink-0 max-w-[calc(100%-8px)] opacity-0 group-hover/event:opacity-100"
                      >
                        Book over
                      </button>
                    )}
                    {isCompletedEvent && (
                      <span
                        className="absolute top-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-success flex items-center justify-center z-10 shrink-0"
                        title="Completed"
                      >
                        <svg viewBox="0 0 10 10" className="h-2 w-2 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1.5,5 4,7.5 8.5,2.5" />
                        </svg>
                      </span>
                    )}
                    <div className={`h-full min-h-0 flex flex-col overflow-hidden py-0.5 gap-[1px] box-border ${isTodo ? "pl-5 pr-1.5" : "px-1.5"}`}>
                      <AppointmentTimedEventRows event={event} />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          </div>
        </div>

        {nowOffset !== null && (
          <div
            className="pointer-events-none absolute inset-x-0 z-30 flex items-center gap-1.5 pl-1.5 pr-2"
            style={{ top: nowOffset }}
          >
            <div className="shrink-0 rounded bg-brand px-2 py-0.5 text-[10px] font-bold text-brand-foreground shadow-sm whitespace-nowrap">
              {formatTime(now)}
            </div>
            <div className="h-px min-w-0 flex-1 bg-brand" />
            <div className="h-2 w-2 shrink-0 rounded-full bg-brand" />
          </div>
        )}
      </div>
    </div>
  );
}


function TutorWeekCalendar({
  visibleStartMins,
  visibleEndHour,
  visibleGridPhaseMins,
  focusDate,
  now,
  events,
  onEventClick,
  onSlotClick,
  customSlotMins = DEFAULT_SLOT_MINS,
  slotAlignMins = 0,
}) {
  const slotRowHeightPx = TIME_SLOT_ROW_MIN_HEIGHT_PX;
  const gridPhaseMins =
    visibleGridPhaseMins != null ? visibleGridPhaseMins : slotAlignMins;
  const gridStartMins = firstSlotOnGridAtOrAfter(
    visibleStartMins,
    gridPhaseMins,
    customSlotMins,
  );
  const gridEndMins = Math.min(24 * 60, Math.max(0, visibleEndHour) * 60);
  const totalMins = Math.max(0, gridEndMins - gridStartMins);
  const slotsCount = Math.max(0, Math.floor(totalMins / customSlotMins));
  const weekHeight = Math.max(slotRowHeightPx, slotsCount * slotRowHeightPx);
  const gridPadTop = Math.max(12, Math.ceil(slotRowHeightPx / 2));
  const paddedWeekHeight = weekHeight + gridPadTop;
  const weekStart = useMemo(() => startOfWeekSunday(focusDate), [focusDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, idx) => addDays(weekStart, idx)),
    [weekStart],
  );

  const visibleTimedEvents = useMemo(
    () =>
      events.filter((event) => {
        if (event.allDay) return false;
        const start = new Date(event.start);
        const weekEnd = addDays(weekStart, 7);
        return (
          start >= weekStart &&
          start < weekEnd &&
          timedEventOverlapsMinuteRange(event, gridStartMins, gridEndMins)
        );
      }),
    [events, weekStart, gridStartMins, gridEndMins],
  );

  const timedGridLayout = useMemo(
    () => ({
      gridPadTop,
      dayStartMins: gridStartMins,
      gridStartMins,
      customSlotMins,
      slotRowHeightPx,
    }),
    [gridPadTop, gridStartMins, customSlotMins, slotRowHeightPx],
  );

  const byDayTimed = useMemo(() => {
    const map = {};
    weekDays.forEach((day) => {
      const key = formatLocalDateKey(day);
      map[key] = layoutWeekDayTimedEvents(
        visibleTimedEvents.filter((event) => isSameDate(new Date(event.start), day)),
        timedGridLayout,
      );
    });
    return map;
  }, [visibleTimedEvents, weekDays, timedGridLayout]);

  const [overflowPopover, setOverflowPopover] = useState(null);

  useEffect(() => {
    setOverflowPopover(null);
  }, [focusDate, events]);

  const eventCountByDay = useMemo(() => {
    const map = {};
    weekDays.forEach((day) => {
      map[formatLocalDateKey(day)] = events.filter((event) =>
        isSameDate(new Date(event.start), day),
      ).length;
    });
    return map;
  }, [events, weekDays]);

  const isCurrentWeek = now >= weekStart && now < addDays(weekStart, 7);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowOffset =
    isCurrentWeek && nowMinutes >= gridStartMins && nowMinutes <= gridEndMins
      ? gridPadTop +
        ((nowMinutes - gridStartMins) / customSlotMins) * slotRowHeightPx
      : null;
  const todayKey = formatLocalDateKey(now);
  const dayStartMins = gridStartMins;
  const weekLabel = `${weekStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} - ${addDays(weekStart, 6).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;

  return (
    <div className="flex flex-col rounded-[12px] border border-border bg-background shadow-sm overflow-x-auto">
      <div className="min-w-[720px] lg:min-w-0">
      <div className="sticky top-0 z-40 border-b border-border bg-background/95 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-background/80">
        <div className="flex shrink-0 border-b border-border bg-muted/30">
          <div className="w-[86px] shrink-0 border-r border-border flex items-end pb-2 px-2">
            <span className="text-[10px] font-medium text-muted-foreground leading-tight">{weekLabel}</span>
          </div>
          {weekDays.map((day, idx) => {
            const key = formatLocalDateKey(day);
            const isToday = key === todayKey;
            const dayCount = eventCountByDay[key] ?? 0;
            return (
              <div
                key={key}
                className="flex-1 px-2 sm:px-3 py-2.5 text-center min-w-[96px] lg:min-w-0"
                style={{
                  borderRight:
                    idx < weekDays.length - 1
                      ? "1px solid hsl(var(--border))"
                      : "none",
                }}
              >
                <div className="flex flex-col items-center min-w-0">
                  <span
                    className={`text-[11px] font-semibold truncate max-w-full leading-tight ${
                      isToday ? "text-[var(--studio-primary)]" : "text-foreground"
                    }`}
                  >
                    {day.toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
                  </span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-px rounded-full ${
                        isToday
                          ? "bg-[color-mix(in_srgb,var(--studio-primary)_15%,transparent)] text-[var(--studio-primary)]"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {dayCount} event{dayCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative flex">
        <div
          className="relative w-[86px] shrink-0 border-r border-border"
          style={{ height: paddedWeekHeight }}
        >
          {Array.from({ length: slotsCount }).map((_, idx) => {
            const currentMins = dayStartMins + idx * customSlotMins;
            const label = formatDayAxisSlotLabel(currentMins);

            return (
              <div
                key={idx}
                className="absolute left-0 right-0"
                style={{ top: gridPadTop + idx * slotRowHeightPx }}
              >
                <div className="-translate-y-1/2 px-2 text-[10px] font-medium text-muted-foreground whitespace-nowrap">
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        {weekDays.map((day, colIdx) => {
          const key = formatLocalDateKey(day);
          const isToday = key === todayKey;
          return (
            <div
              key={`${key}-week-col`}
              className="relative flex-1 group/col cursor-pointer overflow-hidden min-w-[96px] lg:min-w-0"
              style={{
                height: paddedWeekHeight,
                borderRight:
                  colIdx < weekDays.length - 1
                    ? "1px solid hsl(var(--border))"
                    : "none",
                backgroundColor: isToday
                  ? "color-mix(in srgb, var(--studio-primary) 5%, hsl(var(--background)))"
                  : "hsl(var(--background))",
              }}
              onClick={(e) => {
                if (e.target.closest("[data-event]")) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const offsetY = e.clientY - rect.top - gridPadTop;
                const rawIdx = Math.floor(Math.max(0, offsetY) / slotRowHeightPx);
                const slotIdx =
                  slotsCount > 0
                    ? Math.min(Math.max(0, rawIdx), slotsCount - 1)
                    : 0;
                const totalSlotMins = dayStartMins + slotIdx * customSlotMins;
                const h = Math.floor(totalSlotMins / 60);
                const m = totalSlotMins % 60;
                onSlotClick?.({
                  date: formatLocalDateKey(day),
                  time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
                });
              }}
            >
              {Array.from({ length: slotsCount }).map((_, idx) => {
                const slotMins = dayStartMins + idx * customSlotMins;
                const isHourBoundary = slotMins % 60 === 0;
                return (
                  <div
                    key={idx}
                    className={`absolute left-0 right-0 ${isHourBoundary ? "border-b border-border/60" : "border-b border-border/20"}`}
                    style={{
                      top: gridPadTop + idx * slotRowHeightPx,
                      height: slotRowHeightPx,
                    }}
                  />
                );
              })}

              {(byDayTimed[key]?.visible || []).map((event) => (
                <TimedCalendarEventCard
                  key={event.id}
                  event={event}
                  top={event.top}
                  onEventClick={onEventClick}
                  onBookOverClick={(ev) => {
                    const raw = ev.extendedProps?.raw;
                    const instructorId = raw?.teacherID?._id || raw?.teacherID;
                    onSlotClick?.(slotInfoForEvent(ev, instructorId));
                  }}
                  customSlotMins={customSlotMins}
                  slotRowHeightPx={slotRowHeightPx}
                  slotOverflow={event.slotOverflow}
                  onSlotMoreClick={(e, overflow, cardEl) => {
                    const moreKey = `${key}-${overflow.bucketKey}`;
                    const anchor = (
                      cardEl instanceof HTMLElement
                        ? cardEl
                        : e.currentTarget
                    ).getBoundingClientRect();
                    setOverflowPopover((prev) =>
                      prev?.key === moreKey
                        ? null
                        : {
                            key: moreKey,
                            events: overflow.allEvents,
                            style: computeWeekOverflowPopoverStyle(anchor),
                          },
                    );
                  }}
                />
              ))}
            </div>
          );
        })}

        {nowOffset !== null && (
          <div
            className="pointer-events-none absolute inset-x-0 z-30 flex items-center gap-1.5 pl-1.5 pr-2"
            style={{ top: nowOffset }}
          >
            <div className="shrink-0 rounded bg-brand px-2 py-0.5 text-[10px] font-bold text-brand-foreground shadow-sm whitespace-nowrap">
              {formatTime(now)}
            </div>
            <div className="h-px min-w-0 flex-1 bg-brand" />
            <div className="h-2 w-2 shrink-0 rounded-full bg-brand" />
          </div>
        )}
      </div>
      </div>
      {overflowPopover && (
        <TimedEventsOverflowPopover
          events={overflowPopover.events}
          style={overflowPopover.style}
          onClose={() => setOverflowPopover(null)}
          onEventClick={onEventClick}
        />
      )}
    </div>
  );
}


function SlotSizePicker({ value, startMins, onApply }) {
  const [open, setOpen] = useState(false);
  const [startTime, setStartTime] = useState("06:00");
  const [pendingMins, setPendingMins] = useState(value);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setPendingMins(value);
    const base = Number.isFinite(startMins) ? startMins : FULL_START_HOUR * 60;
    const h = Math.floor(base / 60);
    const m = base % 60;
    setStartTime(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }, [open, value, startMins]);

  const placeMenu = useCallback(() => {
    const trigger = rootRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 208; // w-52
    const gap = 8;
    const pad = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.right - menuWidth;
    left = Math.max(pad, Math.min(left, vw - menuWidth - pad));

    const estimatedHeight = menuRef.current?.offsetHeight || 220;
    const spaceBelow = vh - rect.bottom - gap - pad;
    const spaceAbove = rect.top - gap - pad;
    const openAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

    const top = openAbove
      ? Math.max(pad, rect.top - gap - estimatedHeight)
      : Math.min(rect.bottom + gap, Math.max(pad, vh - estimatedHeight - pad));

    setMenuStyle({
      position: "fixed",
      top,
      left,
      width: Math.min(menuWidth, vw - pad * 2),
      zIndex: 100,
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    placeMenu();
    const raf = requestAnimationFrame(placeMenu);
    window.addEventListener("resize", placeMenu);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", placeMenu);
    };
  }, [open, placeMenu]);

  // Close on outside pointer / outer scroll — include portaled menu
  useEffect(() => {
    if (!open) return;

    const isInside = (node) => {
      if (!(node instanceof Node)) return false;
      return Boolean(rootRef.current?.contains(node) || menuRef.current?.contains(node));
    };

    const isTimePicker = () => {
      const ae = document.activeElement;
      return (
        ae instanceof HTMLInputElement &&
        ae.type === "time" &&
        Boolean(menuRef.current?.contains(ae))
      );
    };

    const onPointerDown = (e) => {
      const path =
        typeof e.composedPath === "function" && e.composedPath().length > 0
          ? e.composedPath()
          : [e.target];
      if (path.some((n) => isInside(n))) return;
      if (isTimePicker()) return;
      setOpen(false);
    };

    const onScroll = (e) => {
      if (isInside(e.target)) return;
      if (isTimePicker()) return;
      setOpen(false);
    };

    const id = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("scroll", onScroll, true);
    }, 0);

    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const isActive =
    value !== DEFAULT_SLOT_MINS ||
    (startMins != null && startMins !== FULL_START_HOUR * 60);

  function handleApply() {
    const [h, mm] = startTime.split(":").map(Number);
    const rawMins =
      Number.isFinite(h) && Number.isFinite(mm) ? h * 60 + mm : FULL_START_HOUR * 60;
    onApply(pendingMins, rawMins);
    setOpen(false);
  }

  const menu =
    open && menuStyle && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            style={menuStyle}
            className="rounded-xl border border-border bg-popover shadow-lg p-3 space-y-3"
          >
            <div>
              <p className="text-[11px] font-semibold text-foreground mb-1.5">Slot Size</p>
              <div className="flex flex-wrap gap-1.5">
                {[30, 45, 50, 60, 90].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPendingMins(m)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                      pendingMins === m
                        ? "bg-primary border-primary text-white"
                        : "bg-muted/50 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-foreground mb-1.5">Start Time</p>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const resetMins = DEFAULT_SLOT_MINS;
                  const snapped = snapSlotStartMinutes(FULL_START_HOUR * 60, resetMins);
                  setStartTime("06:00");
                  setPendingMins(resetMins);
                  onApply(resetMins, snapped);
                  setOpen(false);
                }}
                className="flex-1 h-8 rounded-lg border border-border bg-background text-[11px] font-semibold text-muted-foreground hover:bg-muted/40"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="flex-1 h-8 rounded-lg bg-primary text-[11px] font-semibold text-white hover:bg-primary/90 transition-colors"
              >
                Apply
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "h-8 rounded-[20px] border px-2.5 sm:px-3 text-[11px] font-bold transition-colors inline-flex items-center gap-1.5",
          isActive
            ? "border-primary bg-primary/10 text-primary"
            : "border-border bg-background text-foreground hover:bg-muted",
        ].join(" ")}
        style={{ boxShadow: COLORS.shadow }}
      >
        Slot: {value}m
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {menu}
    </div>
  );
}

const STATUS_FILTER_OPTIONS = [
  { value: "all",                label: "All Statuses" },
  { value: "scheduled",          label: "Scheduled" },
  { value: "completed",          label: "Completed" },
  { value: "cancelled_no_charge",label: "Cancelled – No Charge" },
  { value: "cancelled_charged",  label: "Cancelled – Charged" },
  { value: "no_show_no_charge",  label: "No Show – No Charge" },
  { value: "no_show_charged",    label: "No Show – Charged" },
];

const STATUS_DOT = {
  scheduled:           "bg-info",
  completed:           "bg-success",
  cancelled_no_charge: "bg-muted-foreground",
  cancelled_charged:   "bg-destructive",
  no_show_no_charge:   "bg-warning/60",
  no_show_charged:     "bg-warning",
};

function StatusFilterDropdown({ value, onChange, compact = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = STATUS_FILTER_OPTIONS.find((o) => o.value === value) ?? STATUS_FILTER_OPTIONS[0];
  const triggerLabel =
    compact && value === "all"
      ? "Status"
      : compact && current.label.length > 12
        ? current.label.split("–")[0].trim()
        : current.label;

  useCloseOnOuterScroll(open, setOpen, rootRef);
  useCloseOnClickOutside(open, setOpen, rootRef);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-8 rounded-[20px] border border-border bg-background px-2.5 sm:px-3 text-[11px] font-bold text-foreground hover:bg-muted transition-colors inline-flex items-center gap-1.5 max-w-[140px] sm:max-w-none"
        style={{ boxShadow: COLORS.shadow }}
      >
        {value !== "all" && (
          <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[value] ?? "bg-muted-foreground"}`} />
        )}
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full mt-2 w-48 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover shadow-lg py-1.5 z-[60]"
        >
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] transition-colors ${
                value === opt.value
                  ? "font-bold text-foreground bg-muted/60"
                  : "text-foreground hover:bg-muted/40"
              }`}
            >
              <span className={`h-2 w-2 rounded-full shrink-0 ${
                opt.value === "all" ? "bg-muted-foreground" : STATUS_DOT[opt.value] ?? "bg-muted-foreground"
              }`} />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PrivateLessonSummaryBar({ viewMode, focusDate, events, allServices = [] }) {
  const privateServiceCodes = useMemo(
    () => new Set(allServices.filter((s) => !s.type || s.type === "private").map((s) => s.serviceCode)),
    [allServices],
  );

  const cells = useMemo(() => {
    const privateEvents = events.filter((e) => {
      const { eventType, serviceCode } = e.extendedProps ?? {};
      if (eventType !== "private") return false;
      if (!privateServiceCodes.size) return true;
      return privateServiceCodes.has(serviceCode);
    });

    if (viewMode === VIEW_MODE.DAY) {
      const count = privateEvents.filter((e) => {
        const d = new Date(e.start);
        return isSameDate(d, focusDate);
      }).length;
      return [{ label: focusDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), count }];
    }

    if (viewMode === VIEW_MODE.WEEK) {
      const weekStart = startOfWeekSunday(focusDate);
      return Array.from({ length: 7 }, (_, i) => {
        const day = addDays(weekStart, i);
        const count = privateEvents.filter((e) => isSameDate(new Date(e.start), day)).length;
        return {
          label: day.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }),
          count,
          isToday: isSameDate(day, new Date()),
        };
      });
    }

    if (viewMode === VIEW_MODE.MONTH) {
      // Show per-week totals for the 5 weeks of the month view
      const monthStart = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
      const firstSunday = startOfWeekSunday(monthStart);
      return Array.from({ length: 5 }, (_, i) => {
        const weekStart = addDays(firstSunday, i * 7);
        const weekEnd = addDays(weekStart, 6);
        const count = privateEvents.filter((e) => {
          const d = new Date(e.start);
          return d >= weekStart && d <= weekEnd;
        }).length;
        const label = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { day: "numeric" })}`;
        return { label, count };
      });
    }

    return [];
  }, [viewMode, focusDate, events]);

  if (!cells.length || viewMode === VIEW_MODE.LIST) return null;

  const total = cells.reduce((s, c) => s + c.count, 0);

  return (
    <div className="shrink-0 px-3 sm:px-6 py-2 border-b border-border/50 flex items-center gap-3 overflow-x-auto scrollbar-hide">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 shrink-0">
        Private Lessons
      </span>
      <div className="flex items-center gap-1.5">
        {cells.map((cell, i) => (
          <div
            key={i}
            className={[
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium shrink-0 border transition-colors",
              cell.count > 0
                ? "border-brand/30 bg-brand/10 text-brand"
                : "border-border/50 bg-muted/30 text-muted-foreground/50",
              cell.isToday ? "ring-1 ring-brand/40" : "",
            ].join(" ")}
          >
            <span className="text-[10px] text-muted-foreground/70">{cell.label}</span>
            <span className={`font-bold ${cell.count > 0 ? "text-brand" : "text-muted-foreground/40"}`}>
              {cell.count}
            </span>
          </div>
        ))}
      </div>
      <span className="text-[11px] font-bold text-foreground shrink-0">
        {total} total
      </span>
    </div>
  );
}

function TeacherFilterDropdown({ instructors, value, onChange, compact = false, locked = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const current = value ? instructors.find((i) => i.key === value) : null;
  const triggerLabel = current
    ? current.name
    : compact
      ? "Teacher"
      : "T";

  // Own-scope: the server already returns only this user's data, so there's
  // nothing to filter between — render a static pill instead of a picker that
  // would otherwise offer a "clear filter" path back to an empty list.
  if (locked) {
    return (
      <div className="h-8 rounded-[20px] border border-border bg-muted/40 px-2.5 sm:px-3 text-[11px] font-bold text-foreground inline-flex shrink-0 items-center gap-1.5 max-w-[130px] sm:max-w-none">
        {current && (
          <span
            className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white"
            style={{ backgroundColor: current.color }}
          >
            {current.initials}
          </span>
        )}
        <span className="truncate">{current?.name || triggerLabel}</span>
      </div>
    );
  }

  const filtered = query.trim()
    ? instructors.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
    : instructors;

  useCloseOnOuterScroll(open, setOpen, rootRef);
  useCloseOnClickOutside(open, setOpen, rootRef);

  useEffect(() => {
    if (!open) { setQuery(""); return; }
    // Skip auto-focus on touch devices — the soft keyboard can scroll the page
    // and immediately close the menu via useCloseOnOuterScroll.
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) return;
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-8 rounded-[20px] border border-border bg-background px-2.5 sm:px-3 text-[11px] font-bold text-foreground hover:bg-muted transition-colors inline-flex items-center gap-1.5 max-w-[130px] sm:max-w-none"
        style={{ boxShadow: COLORS.shadow }}
      >
        {current && (
          <span
            className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white"
            style={{ backgroundColor: current.color }}
          >
            {current.initials}
          </span>
        )}
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full mt-2 w-52 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover shadow-lg z-[60] overflow-hidden"
        >
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search teachers…"
              className="h-7 w-full rounded-md border border-border bg-muted/30 px-2.5 text-[11px] text-foreground outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="py-1.5 max-h-56 overflow-y-auto">
            {!query.trim() && (
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] transition-colors ${
                  !value ? "font-bold text-foreground bg-muted/60" : "text-foreground hover:bg-muted/40"
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                All Teachers
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">No results</p>
            ) : (
              filtered.map((inst) => (
                <button
                  key={inst.key}
                  type="button"
                  onClick={() => { onChange(inst.key); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] transition-colors ${
                    value === inst.key ? "font-bold text-foreground bg-muted/60" : "text-foreground hover:bg-muted/40"
                  }`}
                >
                  <span
                    className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white"
                    style={{ backgroundColor: inst.color }}
                  >
                    {inst.initials}
                  </span>
                  <span className="truncate">{inst.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function CalendarPageInner() {
  const searchParams = useSearchParams();
  const calendarRef = useRef(null);
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState(VIEW_MODE.DAY);
  const [isAppointmentPanelOpen, setIsAppointmentPanelOpen] = useState(false);
  const [nowMarker, setNowMarker] = useState(() => Date.now());
  const now = useMemo(() => new Date(nowMarker), [nowMarker]);

  const [events, setEvents] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const memberSelectionsRef = useRef({});
  const membershipCoverageRef = useRef(new Set()); // "customerID::serviceCode" for active memberships // appointmentId -> memberIds[]
  const allTeachersRef = useRef([]);
  const studioTzRef = useRef(null); // IANA timezone for the active studio location
  const [studioTz, setStudioTz] = useState(null);
  const [allServices, setAllServices] = useState([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  // Own-scope calendar.bookings means the server already returns only this
  // user's events and /api/teacher only returns them as a teacher — locking the
  // client filter to self too is belt-and-braces, not the real enforcement.
  // Gated on a resolved user id so a session predating the /api/auth/me
  // rollout (no _id yet) can't lock onto `undefined` and blank the calendar.
  const currentUserId = useMemo(() => getCurrentUserId(), []);
  const lockToSelf = isOwnScope("calendar", "bookings") && !!currentUserId;
  // /settings/users-roles/teachers links here with ?teacherID=<id> to jump
  // straight to one teacher's schedule. Own-scope wins when both apply — a
  // locked session has nothing else to show regardless of the link.
  const deepLinkTeacherId = searchParams?.get("teacherID") || null;
  const [selectedTeacherId, setSelectedTeacherId] = useState(() =>
    lockToSelf ? String(currentUserId) : deepLinkTeacherId
  );
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [slotSelection, setSlotSelection] = useState(null);
  const [hideEmptySlots, setHideEmptySlots] = useState(false);
  const [customSlotMins, setCustomSlotMins] = useState(() => {
    try { const n = Number(localStorage.getItem("cal_slotMins")); return Number.isFinite(n) && n > 0 ? n : DEFAULT_SLOT_MINS; } catch { return DEFAULT_SLOT_MINS; }
  });
  const [slotAlignMins, setSlotAlignMins] = useState(() => {
    try { const n = Number(localStorage.getItem("cal_startMins")); return Number.isFinite(n) && n >= 0 ? n : FULL_START_HOUR * 60; } catch { return FULL_START_HOUR * 60; }
  });

  useEffect(() => {
    let cancelled = false;
    const loadCalendarSettings = () => {
      api.get("/api/organisation/calendar-settings").then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          const { slotMins, startMins } = res.data;
          if (Number.isFinite(slotMins) && slotMins > 0) {
            setCustomSlotMins(slotMins);
            try { localStorage.setItem("cal_slotMins", String(slotMins)); } catch {}
          }
          if (Number.isFinite(startMins) && startMins >= 0) {
            setSlotAlignMins(startMins);
            try { localStorage.setItem("cal_startMins", String(startMins)); } catch {}
          }
          return;
        }
        // api.get() never rejects — a failed request just resolves with
        // success:false — so this branch (not a .catch) is what previously ran
        // silently on failure, leaving slotAlignMins/customSlotMins stuck on
        // whatever startMins/slotMins happened to be cached in this browser's
        // localStorage. That's stale relative to the org's real setting (e.g. an
        // older start time), which shows up as every availability slot being off
        // by a fixed offset for anyone whose browser hasn't refreshed that cache.
        // Retry once so a transient failure doesn't leave the stale value in place.
        console.error("Failed to load calendar settings:", res.error);
        setTimeout(() => { if (!cancelled) loadCalendarSettings(); }, 3000);
      });
    };
    loadCalendarSettings();
    return () => { cancelled = true; };
  }, []);

  // slotDuration string for FullCalendar (HH:MM:SS)
  const slotDurationStr = useMemo(() => {
    const h = Math.floor(customSlotMins / 60);
    const m = customSlotMins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  }, [customSlotMins]);

  const rangeStart = useMemo(() => {
    const monthStart = new Date(
      focusDate.getFullYear(),
      focusDate.getMonth(),
      1,
    );
    return addDays(startOfWeekSunday(monthStart), -28);
  }, [focusDate]);

  const rangeEnd = useMemo(() => addDays(rangeStart, 120), [rangeStart]);

  const fetchCalendarEvents = useCallback(async () => {
    setIsLoadingEvents(true);
    const params = new URLSearchParams({
      start: rangeStart.toISOString(),
      end: rangeEnd.toISOString(),
      limit: 1000,
    });
    const result = await api.get(`/api/calendar?${params}`);
    if (result.success && Array.isArray(result.data)) {
      const derived = deriveInstructors(result.data);
      // If active teachers have been fetched, use that as the source of truth
      // and filter out any event-derived teachers who are no longer active
      const activeTeachers = allTeachersRef.current;
      let merged;
      if (activeTeachers.length > 0) {
        const activeIds = new Set(activeTeachers.map((t) => t.key));
        // Keep only active teachers, using event-derived color/data where available
        const derivedMap = new Map(derived.map((i) => [i.key, i]));
        merged = activeTeachers.map((t) => derivedMap.get(t.key) ?? t);
        // Also keep event-derived teachers not yet in allTeachersRef (race condition safety)
        derived.forEach((d) => {
          if (!activeIds.has(d.key)) return; // skip inactive
          if (!merged.find((m) => m.key === d.key)) merged.push(d);
        });
      } else {
        merged = derived;
      }
      const colorMap = buildColorMap(merged);
      setEvents(transformAppointments(result.data, colorMap, memberSelectionsRef.current, membershipCoverageRef.current, studioTzRef.current));
      setInstructors(merged.length > 0 ? merged : derived);
    }
    setIsLoadingEvents(false);
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    fetchCalendarEvents();
  }, [fetchCalendarEvents]);

  // Re-place events once studio TZ is known (first fetch often races ahead of TZ load).
  useEffect(() => {
    if (!studioTz) return;
    fetchCalendarEvents();
  }, [studioTz]); // eslint-disable-line react-hooks/exhaustive-deps -- only when TZ arrives/changes

  useEffect(() => {
    api.get("/api/calendar-service?limit=200").then((res) => {
      if (res.success && Array.isArray(res.data)) setAllServices(res.data);
    });
    api.get("/api/customer-membership?status=active&limit=1000").then((res) => {
      if (!res.success || !Array.isArray(res.data)) return;
      const set = new Set();
      res.data.forEach((m) => {
        if (m.status !== "active") return;
        const cid = String(m.customerID?._id ?? m.customerID ?? "");
        (m.services || []).forEach((s) => {
          if (cid && s.serviceCode) set.add(`${cid}::${s.serviceCode}`);
        });
      });
      membershipCoverageRef.current = set;
    });
    // Active branch is sent via x-location-id; use THAT location's timezone so
    // Midtown (etc.) wall-clock times render correctly even when the browser is
    // in IST. /api/location always returns every studio (the branch switcher
    // needs the full list), so grabbing the first entry with a timezone picked
    // whichever studio happened to sort first — not the one actually selected —
    // and misplaced events onto the wrong day/column after switching studios.
    api.get("/api/location?limit=50").then((res) => {
      const list = Array.isArray(res?.data) ? res.data : [];
      const activeBranchId = getEffectiveBranch();
      const active = activeBranchId
        ? list.find((l) => String(l?._id) === String(activeBranchId))
        : null;
      const tz = active?.timezone || list.find((l) => l?.timezone)?.timezone || list[0]?.timezone;
      if (tz) {
        studioTzRef.current = tz;
        setStudioTz(tz);
      }
    }).catch(() => {});
  }, []);

  // Fetch all teachers once so every teacher shows as a column even with no events
  useEffect(() => {
    api.get("/api/teacher?limit=200&status=active").then((res) => {
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        const fetched = res.data.map((t, idx) => {
          const parts = (t.name || "").trim().split(/\s+/);
          const initials =
            parts.length >= 2
              ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
              : (t.name || "??").slice(0, 2).toUpperCase();
          return {
            key: String(t._id),
            initials,
            name: t.name || "",
            color: CALENDAR_PALETTE[idx % CALENDAR_PALETTE.length],
          };
        });
        // The server already scopes this list to self under own-scope; filtering
        // here too is a defensive backstop, not the enforcement.
        const visible = lockToSelf ? fetched.filter((t) => t.key === String(currentUserId)) : fetched;
        allTeachersRef.current = visible;
        // Replace instructor list with only active teachers, preserving event-derived data
        setInstructors((prev) => {
          const prevMap = new Map(prev.map((i) => [i.key, i]));
          return visible.map((t) => prevMap.get(t.key) ?? t);
        });
      }
    });
  }, []);

  const headerLabel = useMemo(() => {
    if (viewMode === VIEW_MODE.LIST) {
      const end = addDays(focusDate, 13);
      const startStr = focusDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const endStr   = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return `${startStr} – ${endStr}`;
    }
    return formatHeaderLabel(focusDate, viewMode);
  }, [focusDate, viewMode]);

  // Apply status filter — compare against effectiveStatus (auto-completed for past events)
  const filteredEvents = useMemo(() => {
    let result = events;
    if (statusFilter !== "all") {
      result = result.filter(
        (e) => (e.extendedProps?.effectiveStatus ?? e.extendedProps?.status ?? "scheduled") === statusFilter,
      );
    }
    if (selectedTeacherId) {
      result = result.filter((e) => eventBelongsToTutor(e, selectedTeacherId));
    }
    return result;
  }, [events, statusFilter, selectedTeacherId]);

  const snappedGridStartMins = slotAlignMins;

  /** Visible time range for day + week grids (Hide empty). */
  const visibleWindow = useMemo(() => {
    const baseStartMins = snappedGridStartMins;
    const baseEndHour = FULL_END_HOUR;
    const baseEndMins = baseEndHour * 60;
    const padMins = 60;

    const gridPhaseMins = baseStartMins;

    const finish = (startMins, endHour) => {
      const clampedStart = Math.max(0, Math.min(startMins, 24 * 60));
      const clampedEndHour = Math.max(
        Math.ceil(clampedStart / 60) + 1,
        Math.min(24, endHour),
      );
      return {
        visibleStartMins: clampedStart,
        visibleEndHour: clampedEndHour,
        visibleGridPhaseMins: gridPhaseMins,
        effectiveSlotMinStr: minutesToFcTimeString(clampedStart),
        effectiveSlotMaxStr: minutesToFcTimeString(clampedEndHour * 60),
      };
    };

    const timedForWindow =
      viewMode === VIEW_MODE.DAY
        ? filteredEvents.filter(
            (e) =>
              !e.allDay && isSameDate(new Date(e.start), focusDate),
          )
        : (() => {
            const weekStart = startOfWeekSunday(focusDate);
            const weekEnd = addDays(weekStart, 7);
            return filteredEvents.filter((e) => {
              const s = new Date(e.start);
              return !e.allDay && s >= weekStart && s < weekEnd;
            });
          })();

    if (timedForWindow.length === 0) {
      return finish(baseStartMins, baseEndHour);
    }

    let minMins = 24 * 60;
    let maxMins = 0;
    timedForWindow.forEach((e) => {
      const s = new Date(e.start);
      const en = new Date(e.end);
      minMins = Math.min(minMins, s.getHours() * 60 + s.getMinutes());
      // An event ending exactly at midnight has an `end` timestamp on the
      // *next* calendar day at 00:00 — getHours() reads that as 0, indistin-
      // guishable from a start-of-day time, which would shrink the "hide
      // empty slots" window down to just after midnight instead of out to
      // the event's real end. Same day-crossing check timedEventOverlapsMinuteRange
      // already uses above.
      const endMins =
        en.getDate() !== s.getDate() ? 24 * 60 : en.getHours() * 60 + en.getMinutes();
      maxMins = Math.max(maxMins, endMins);
    });

    // baseStartMins/baseEndHour are just the grid's *default* bounds (6am–
    // midnight, or wherever the user set "day start"). A real event outside
    // that range must never be clipped, whether or not "Hide Empty" is on —
    // previously the window floored at baseStartMins unconditionally, which
    // silently hid any event before it (e.g. a 5:30am to-do) from day/week
    // view even though it showed fine in month view. So always extend the
    // window to cover real events; "Hide Empty" additionally shrinks the
    // *unused* slack around them.
    if (!hideEmptySlots) {
      const start = Math.min(baseStartMins, minMins);
      const endHour = Math.max(baseEndHour, Math.ceil(maxMins / 60));
      return finish(start, endHour);
    }

    const paddedStart = Math.min(baseStartMins, Math.max(0, minMins - padMins));
    const paddedEndMins = Math.min(baseEndMins, maxMins + padMins);
    const snappedStart = firstSlotOnGridAtOrAfter(
      paddedStart,
      gridPhaseMins,
      customSlotMins,
    );
    const endHour = Math.min(
      baseEndHour,
      Math.max(Math.ceil(snappedStart / 60) + 1, Math.ceil(paddedEndMins / 60)),
    );

    return finish(snappedStart, endHour);
  }, [
    hideEmptySlots,
    filteredEvents,
    focusDate,
    viewMode,
    snappedGridStartMins,
    customSlotMins,
  ]);

  const dayTimedEvents = useMemo(
    () =>
      filteredEvents.filter(
        (event) =>
          !event.allDay && isSameDate(new Date(event.start), focusDate),
      ),
    [filteredEvents, focusDate],
  );
  const dayAllDayEvents = useMemo(
    () =>
      filteredEvents.filter(
        (event) => event.allDay && isSameDate(new Date(event.start), focusDate),
      ),
    [filteredEvents, focusDate],
  );

  const getCalendarApi = () => calendarRef.current?.getApi();

  const syncDateFromApi = () => {
    const api = getCalendarApi();
    if (!api) return;
    setFocusDate(new Date(api.getDate()));
  };

  const switchToMode = (mode, date = null) => {
    if (mode === VIEW_MODE.DAY || mode === VIEW_MODE.WEEK || mode === VIEW_MODE.LIST) {
      setViewMode(mode);
      if (date) setFocusDate(new Date(date));
      return;
    }

    const calApi = getCalendarApi();
    if (!calApi) {
      setViewMode(mode);
      if (date) setFocusDate(new Date(date));
      return;
    }
    calApi.changeView(FULLCALENDAR_VIEW[mode], date ?? calApi.getDate());
    setViewMode(mode);
    setFocusDate(new Date(date ?? calApi.getDate()));
  };

  const navigateToDate = (date) => {
    const d = new Date(date);
    setFocusDate(d);
    if (viewMode === VIEW_MODE.MONTH) {
      const calApi = getCalendarApi();
      if (calApi) calApi.gotoDate(d);
    }
  };

  const goToToday = () => {
    if (viewMode === VIEW_MODE.LIST) {
      setFocusDate(new Date());
      return;
    }
    navigateToDate(new Date());
  };

  const shiftView = (direction) => {
    if (viewMode === VIEW_MODE.DAY) {
      setFocusDate((prev) => addDays(prev, direction));
      return;
    }
    if (viewMode === VIEW_MODE.WEEK) {
      setFocusDate((prev) => addDays(prev, direction * 7));
      return;
    }
    if (viewMode === VIEW_MODE.LIST) {
      // shift by 14 days (one list window)
      setFocusDate((prev) => addDays(prev, direction * 14));
      return;
    }

    const calApi = getCalendarApi();
    if (!calApi) return;
    if (direction < 0) calApi.prev();
    else calApi.next();
    syncDateFromApi();
  };

  useEffect(() => {
    const timer = setInterval(() => setNowMarker(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (viewMode !== VIEW_MODE.MONTH) return;
    const calApi = getCalendarApi();
    if (!calApi) return;
    calApi.changeView(FULLCALENDAR_VIEW[viewMode]);
  }, [viewMode]);

  return (
    <MainLayout
      title="Calendar"
      subtitle=""
      mainClassName="pt-0 sm:pt-0"
    >
      <div className="w-full min-h-0">
        <div className="bg-background rounded-[24px_0px_24px_24px] w-full flex flex-col pt-3 sm:pt-4">
          <div className="shrink-0 px-3 sm:px-6 py-2 border-b border-border/50 space-y-2 lg:space-y-0 relative z-50 overflow-visible">
            {/* Row 1: date nav + create (mobile) / full desktop toolbar */}
            <div className="flex items-center justify-between gap-2 lg:gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="hidden lg:block">
                  <ViewOptionsDropdown
                    hideEmptySlots={hideEmptySlots}
                    setHideEmptySlots={setHideEmptySlots}
                    goToToday={goToToday}
                  />
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <IconCircleButton ariaLabel="Previous" onClick={() => shiftView(-1)}>
                    <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                  </IconCircleButton>
                  <CalendarDatePicker
                    focusDate={focusDate}
                    label={headerLabel}
                    onSelectDate={navigateToDate}
                  />
                  <IconCircleButton ariaLabel="Next" onClick={() => shiftView(1)}>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </IconCircleButton>
                </div>
              </div>

              <div className="hidden lg:flex items-center gap-2">
                {isLoadingEvents && (
                  <svg className="h-4 w-4 animate-spin text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                )}

                <div className="flex items-center shrink-0">
                  <SegmentedButton
                    active={viewMode === VIEW_MODE.DAY}
                    className="rounded-[30px_0px_0px_30px]"
                    onClick={() => switchToMode(VIEW_MODE.DAY)}
                  >
                    Day
                  </SegmentedButton>
                  <SegmentedButton
                    active={viewMode === VIEW_MODE.WEEK}
                    className="rounded-none border-l-0"
                    onClick={() => switchToMode(VIEW_MODE.WEEK)}
                  >
                    Week
                  </SegmentedButton>
                  <SegmentedButton
                    active={viewMode === VIEW_MODE.MONTH}
                    className="rounded-none border-l-0"
                    onClick={() => switchToMode(VIEW_MODE.MONTH)}
                  >
                    Month
                  </SegmentedButton>
                  <SegmentedButton
                    active={viewMode === VIEW_MODE.LIST}
                    className="rounded-[0px_30px_30px_0px] border-l-0"
                    onClick={() => switchToMode(VIEW_MODE.LIST)}
                  >
                    List
                  </SegmentedButton>
                </div>

                {instructors.length > 0 && (
                  <TeacherFilterDropdown
                    instructors={instructors}
                    value={selectedTeacherId}
                    onChange={setSelectedTeacherId}
                    locked={lockToSelf}
                  />
                )}
                <StatusFilterDropdown value={statusFilter} onChange={setStatusFilter} />
                <SlotSizePicker
                  value={customSlotMins}
                  startMins={slotAlignMins}
                  onApply={(mins, startOff) => {
                    setCustomSlotMins(mins);
                    setSlotAlignMins(startOff);
                    try { localStorage.setItem("cal_slotMins", String(mins)); localStorage.setItem("cal_startMins", String(startOff)); } catch {}
                    api.patch("/api/organisation/calendar-settings", { slotMins: mins, startMins: startOff });
                  }}
                />

                <button
                  type="button"
                  onClick={() => setIsAppointmentPanelOpen(true)}
                  className="h-8 rounded-[20px] bg-brand px-4 text-[11px] font-bold text-brand-foreground hover:bg-brand-dark active:scale-[0.98] transition-all shrink-0"
                >
                  + Create
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsAppointmentPanelOpen(true)}
                className="lg:hidden h-8 rounded-[20px] bg-brand px-3 text-[11px] font-bold text-brand-foreground hover:bg-brand-dark active:scale-[0.98] transition-all shrink-0"
              >
                + Create
              </button>
            </div>

            {/* Mobile / tablet only: view switcher + filter chips */}
            <div className="lg:hidden space-y-2">
              <div className="flex items-center gap-2">
                {isLoadingEvents && (
                  <svg className="h-4 w-4 animate-spin text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                )}
                <div className="flex items-center flex-1 min-w-0">
                  <SegmentedButton
                    active={viewMode === VIEW_MODE.DAY}
                    className="flex-1 rounded-[30px_0px_0px_30px] px-0"
                    onClick={() => switchToMode(VIEW_MODE.DAY)}
                  >
                    Day
                  </SegmentedButton>
                  <SegmentedButton
                    active={viewMode === VIEW_MODE.WEEK}
                    className="flex-1 rounded-none border-l-0 px-0"
                    onClick={() => switchToMode(VIEW_MODE.WEEK)}
                  >
                    Week
                  </SegmentedButton>
                  <SegmentedButton
                    active={viewMode === VIEW_MODE.MONTH}
                    className="flex-1 rounded-none border-l-0 px-0"
                    onClick={() => switchToMode(VIEW_MODE.MONTH)}
                  >
                    Month
                  </SegmentedButton>
                  <SegmentedButton
                    active={viewMode === VIEW_MODE.LIST}
                    className="flex-1 rounded-[0px_30px_30px_0px] border-l-0 px-0"
                    onClick={() => switchToMode(VIEW_MODE.LIST)}
                  >
                    List
                  </SegmentedButton>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ViewOptionsDropdown
                  compact
                  hideEmptySlots={hideEmptySlots}
                  setHideEmptySlots={setHideEmptySlots}
                  goToToday={goToToday}
                />
                {instructors.length > 0 && (
                  <TeacherFilterDropdown
                    compact
                    instructors={instructors}
                    value={selectedTeacherId}
                    onChange={setSelectedTeacherId}
                    locked={lockToSelf}
                  />
                )}
                <StatusFilterDropdown compact value={statusFilter} onChange={setStatusFilter} />
                <SlotSizePicker
                  value={customSlotMins}
                  startMins={slotAlignMins}
                  onApply={(mins, startOff) => {
                    setCustomSlotMins(mins);
                    setSlotAlignMins(startOff);
                    try { localStorage.setItem("cal_slotMins", String(mins)); localStorage.setItem("cal_startMins", String(startOff)); } catch {}
                    api.patch("/api/organisation/calendar-settings", { slotMins: mins, startMins: startOff });
                  }}
                />
              </div>
            </div>
          </div>


          <div className="px-3 sm:px-6 pt-4 sm:pt-6 pb-6">
            <div className="flex gap-4 min-w-0">
              <div className="flex-1 min-w-0">
                {viewMode === VIEW_MODE.DAY ? (
                  <TutorDayCalendar
                    key={`day-${customSlotMins}-${snappedGridStartMins}-${visibleWindow.visibleStartMins}-${visibleWindow.visibleEndHour}`}
                    visibleStartMins={visibleWindow.visibleStartMins}
                    visibleEndHour={visibleWindow.visibleEndHour}
                    visibleGridPhaseMins={visibleWindow.visibleGridPhaseMins}
                    focusDate={focusDate}
                    now={now}
                    dayTimedEvents={dayTimedEvents}
                    dayAllDayEvents={dayAllDayEvents}
                    tutors={selectedTeacherId ? instructors.filter((i) => i.key === selectedTeacherId) : instructors}
                    allEvents={filteredEvents}
                    onEventClick={(raw) => {
                      setSelectedEvent(raw);
                      setIsAppointmentPanelOpen(false);
                    }}
                    onSlotClick={({ date, time, instructorId }) => {
                      setSlotSelection({ date, time, instructorId });
                      setSelectedEvent(null);
                      setIsAppointmentPanelOpen(true);
                    }}
                    onColumnReorder={(orderedKeys) => {
                      setInstructors((prev) => {
                        const orderMap = new Map(orderedKeys.map((k, i) => [k, i]));
                        return [...prev].sort((a, b) => (orderMap.get(a.key) ?? 999) - (orderMap.get(b.key) ?? 999));
                      });
                      api.patch("/api/teacher/reorder", { order: orderedKeys });
                    }}
                    customSlotMins={customSlotMins}
                    slotAlignMins={snappedGridStartMins}
                  />
                ) : viewMode === VIEW_MODE.WEEK ? (
                  <TutorWeekCalendar
                    key={`week-${customSlotMins}-${snappedGridStartMins}-${visibleWindow.visibleStartMins}-${visibleWindow.visibleEndHour}-${formatLocalDateKey(startOfWeekSunday(focusDate))}`}
                    visibleStartMins={visibleWindow.visibleStartMins}
                    visibleEndHour={visibleWindow.visibleEndHour}
                    visibleGridPhaseMins={visibleWindow.visibleGridPhaseMins}
                    focusDate={focusDate}
                    now={now}
                    events={filteredEvents}
                    onEventClick={(raw) => {
                      setSelectedEvent(raw);
                      setIsAppointmentPanelOpen(false);
                    }}
                    onSlotClick={({ date, time }) => {
                      setSlotSelection({ date, time });
                      setSelectedEvent(null);
                      setIsAppointmentPanelOpen(true);
                    }}
                    customSlotMins={customSlotMins}
                    slotAlignMins={snappedGridStartMins}
                  />
                ) : viewMode === VIEW_MODE.LIST ? (
                  <ListCalendarView
                    events={filteredEvents}
                    focusDate={focusDate}
                    onEventClick={(raw) => {
                      setSelectedEvent(raw);
                      setIsAppointmentPanelOpen(false);
                    }}
                  />
                ) : (
                  <div
                    className="rounded-[12px] border border-border bg-background calendar-shell calendar-shell--month shadow-sm"
                    style={{
                      "--cal-time-slot-min-height": `${TIME_SLOT_ROW_MIN_HEIGHT_PX}px`,
                      "--cal-event-min-height": `${TIMED_EVENT_CARD_DISPLAY_HEIGHT_PX}px`,
                    }}
                  >
                    {/* FullCalendar all-day row: was `allDaySlot` (default on); using false hides it */}
                    <FullCalendar
                      key={`fc-${viewMode}-${customSlotMins}-${snappedGridStartMins}-${visibleWindow.effectiveSlotMinStr}-${visibleWindow.effectiveSlotMaxStr}`}
                      ref={calendarRef}
                      plugins={[
                        dayGridPlugin,
                        timeGridPlugin,
                        interactionPlugin,
                      ]}
                      initialView={FULLCALENDAR_VIEW[viewMode]}
                      initialDate={focusDate}
                      headerToolbar={false}
                      height="auto"
                      nowIndicator
                      allDaySlot={false}
                      slotMinTime={visibleWindow.effectiveSlotMinStr}
                      slotMaxTime={visibleWindow.effectiveSlotMaxStr}
                      slotDuration={slotDurationStr}
                      snapDuration={slotDurationStr}
                      slotLabelInterval={slotDurationStr}
                      slotLabelFormat={{
                        hour: "numeric",
                        minute: "2-digit",
                        omitZeroMinute: false,
                        meridiem: "short",
                      }}
                      stickyHeaderDates
                      dayMaxEvents={false}
                      eventMaxStack={10}
                      eventMinHeight={TIMED_EVENT_CARD_DISPLAY_HEIGHT_PX}
                      expandRows
                      events={filteredEvents}
                      editable={false}
                      selectable
                      navLinks
                      eventOverlap
                      slotEventOverlap={false}
                      datesSet={(arg) => {
                        setViewMode(mapViewTypeToMode(arg.view.type));
                        setFocusDate(new Date(arg.view.calendar.getDate()));
                      }}
                      dateClick={(arg) => {
                        const clickedDate = arg.dateStr?.slice(0, 10) ?? "";
                        const clickedTime = arg.dateStr?.slice(11, 16) ?? "";
                        setSlotSelection({ date: clickedDate, time: clickedTime });
                        setSelectedEvent(null);
                        setIsAppointmentPanelOpen(true);
                      }}
                      navLinkDayClick={(date) =>
                        switchToMode(VIEW_MODE.DAY, date)
                      }
                      eventClick={(arg) => {
                        const raw = arg.event.extendedProps?.raw;
                        if (raw) {
                          setSelectedEvent(raw);
                          setIsAppointmentPanelOpen(false);
                        }
                      }}
                      eventContent={renderEventContent}
                      eventDidMount={(info) => {
                        const el = info.el;
                        const harness =
                          el.closest(".fc-timegrid-event-harness") ||
                          el.closest(".fc-daygrid-event-harness") ||
                          el.parentElement;
                        const props = info.event.extendedProps || {};
                        if (harness && info.event.start && !info.event.allDay) {
                          applyTimedEventCardLayout(harness);
                          const eventType = props.eventType || info.event.extendedProps?.eventType;
                          if (eventType) {
                            harness.dataset.eventType = eventType;
                          }
                        }
                        el.addEventListener("mouseenter", (e) => {
                          harness.style.zIndex = "100";
                          showEventTooltip(e, props);
                        });
                        el.addEventListener("mousemove", (e) => positionTooltip(e));
                        el.addEventListener("mouseleave", () => {
                          harness.style.zIndex = "";
                          hideEventTooltip();
                        });
                      }}
                      displayEventTime={false}
                      views={{
                        dayGridMonth: { dayMaxEventRows: 3 },
                        timeGridWeek: {
                          dayHeaderFormat: { weekday: "short", day: "numeric" },
                        },
                      }}
                    />
                  </div>
                )}
              </div>

              <AppointmentComposerPanel
                open={isAppointmentPanelOpen}
                studioTz={studioTz}
                onClose={() => {
                  setIsAppointmentPanelOpen(false);
                  setSlotSelection(null);
                }}
                onCreated={(memberMap) => {
                  if (memberMap) Object.assign(memberSelectionsRef.current, memberMap);
                  fetchCalendarEvents();
                }}
                initialDate={slotSelection?.date}
                initialTime={slotSelection?.time}
                initialInstructorId={slotSelection?.instructorId}
                initialDuration={customSlotMins}
                initialSlotAlignMins={snappedGridStartMins}
                initialDayEndHour={visibleWindow.visibleEndHour}
              />
              <EventDetailPanel
                open={Boolean(selectedEvent) && !isAppointmentPanelOpen}
                event={selectedEvent ?? {}}
                studioTz={studioTz}
                onClose={() => setSelectedEvent(null)}
                onUpdated={() => {
                  fetchCalendarEvents();
                  setSelectedEvent(null);
                }}
                onDeleted={() => {
                  fetchCalendarEvents();
                  setSelectedEvent(null);
                }}
                onRosterChanged={(memberInfo) => {
                  if (
                    memberInfo?.eventId &&
                    memberInfo?.customerId &&
                    memberInfo?.memberNames?.length > 0
                  ) {
                    const eid = String(memberInfo.eventId);
                    memberSelectionsRef.current[eid] = {
                      ...(memberSelectionsRef.current[eid] || {}),
                      [String(memberInfo.customerId)]: memberInfo.memberNames,
                    };
                  }
                  fetchCalendarEvents();
                }}
                onPaymentSuccess={fetchCalendarEvents}
              />
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}

// useSearchParams (for the ?teacherID= deep link) requires a Suspense boundary
// around anything that reads it, or Next opts the whole page out of static
// rendering with a build warning.
export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarPageInner />
    </Suspense>
  );
}
//