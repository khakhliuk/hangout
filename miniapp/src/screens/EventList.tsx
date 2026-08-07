import { useState } from "react";
import {
  Badge,
  Button,
  Cell,
  FixedLayout,
  List,
  Placeholder,
  Section,
} from "@telegram-apps/telegram-ui";
import PersonIcon from "../components/PersonIcon";
import VoteIcon from "../components/VoteIcon";
import {
  eventStatus,
  formatSlot,
  goingRsvps,
  myRsvp,
  winningPlace,
  winningSlot,
  type EventStatus,
} from "../lib/event";
import { useNow } from "../lib/useNow";
import { CATEGORIES, type EventItem } from "../lib/types";

type Props = {
  events: EventItem[];
  meId: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onHowItWorks: () => void;
};

// The people-count badge doubles as the "you're in" marker: filled green when
// going, muted fill when queued, outline otherwise. Nothing is added to the
// row — the badge is already rendered exactly when an RSVP is possible
// (showGoingBadge and canRsvp cover the same statuses), so the two states can
// never contradict each other.
//
// Order matters: being in wins over the event being full, otherwise a full
// event you're attending would render in the same grey as one you're locked
// out of.
function badgeStyle(
  mine: string | undefined,
  full: boolean,
): React.CSSProperties | undefined {
  if (mine === "going") return { background: "#1b8046", color: "#ffffff" };
  const muted = {
    background: "var(--tgui--secondary_fill)",
    color: "var(--tgui--hint_color)",
  };
  if (mine === "waitlisted") return muted;
  return full ? muted : undefined;
}

function description(event: EventItem, status: EventStatus) {
  if (status === "cancelled") return "Скасовано";
  const slot = winningSlot(event);
  const place = winningPlace(event);
  const parts: string[] = [];
  if (slot && status !== "proposed") {
    parts.push(formatSlot(slot.startsAt));
  }
  if (place) {
    parts.push(
      place.name +
        (event.placeOptions.length > 1 && status === "proposed"
          ? ` +${event.placeOptions.length - 1}`
          : ""),
    );
  }
  return parts.join(" · ");
}

function EventCell({
  event,
  meId,
  onOpen,
  highlight,
}: {
  event: EventItem;
  meId: string;
  onOpen: (id: string) => void;
  highlight?: boolean;
}) {
  const status = eventStatus(event);
  const going = goingRsvps(event).length;
  const full = event.maxPeople !== null && going >= event.maxPeople;
  const showGoingBadge = status === "confirmed" || status === "ongoing";
  const dim = status === "happened" || status === "cancelled";
  const mine = myRsvp(event, meId);
  return (
    <Cell
      className={highlight ? "today-cell" : undefined}
      before={
        <span style={{ fontSize: 28, lineHeight: 1 }}>
          {CATEGORIES[event.category].emoji}
        </span>
      }
      subtitle={description(event, status)}
      after={
        showGoingBadge ? (
          <Badge type="number" style={badgeStyle(mine?.status, full)}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                lineHeight: 1,
              }}
            >
              <span style={{ lineHeight: 1 }}>
                {event.maxPeople ? `${going}/${event.maxPeople}` : `${going}`}
              </span>
              <PersonIcon size={15} />
            </span>
          </Badge>
        ) : status === "proposed" ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 13,
              fontWeight: 600,
              padding: "5px 10px",
              borderRadius: 999,
              background: "rgba(255, 193, 7, 0.16)",
              color: "#b8860b",
              whiteSpace: "nowrap",
            }}
          >
            <VoteIcon size={12} /> Голосуємо
          </span>
        ) : undefined
      }
      style={dim ? { opacity: 0.55 } : undefined}
      onClick={() => onOpen(event.id)}
    >
      {event.title}
    </Cell>
  );
}

function earliestSlotMs(event: EventItem): number {
  const times = event.slots.map((s) => new Date(s.startsAt).getTime());
  return times.length ? Math.min(...times) : Infinity;
}

function bySlotTime(a: EventItem, b: EventItem) {
  return earliestSlotMs(a) - earliestSlotMs(b);
}

// The time an event actually lands on, once it's decided — the confirmed slot
// rather than the earliest proposed one, which can differ when a later date
// won the vote.
function decidedSlotMs(event: EventItem): number | null {
  const slot = winningSlot(event);
  return slot ? new Date(slot.startsAt).getTime() : null;
}

// `now` is passed in rather than read from the clock here, so the comparison is
// tied to the value that triggers the re-render — see useNow.
function isToday(ms: number, now: number): boolean {
  const d = new Date(ms);
  const ref = new Date(now);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

export default function EventList({
  events,
  meId,
  onOpen,
  onCreate,
  onHowItWorks,
}: Props) {
  const [showPast, setShowPast] = useState(false);

  // Re-renders the list as the clock moves, so an event drops out of "Сьогодні"
  // at midnight and out of "ongoing" when it ends, without needing a data
  // refresh. eventStatus() reads Date.now() itself; the tick is what makes it
  // run again.
  const now = useNow();

  const withStatus = events.map((e) => ({ event: e, status: eventStatus(e) }));

  // "Сьогодні" holds what's already running plus what's locked in for the rest
  // of the day. Events still being voted on stay out of it no matter which date
  // is currently leading: their card deliberately shows no date at all, so
  // filing them under a day would promise a certainty that isn't there yet.
  const today = withStatus
    .filter((x) => {
      if (x.status === "ongoing") return true;
      if (x.status !== "confirmed") return false;
      const ms = decidedSlotMs(x.event);
      return ms !== null && isToday(ms, now);
    })
    .map((x) => x.event)
    .sort((a, b) => (decidedSlotMs(a) ?? 0) - (decidedSlotMs(b) ?? 0));

  const todayIds = new Set(today.map((e) => e.id));
  const upcoming = withStatus
    .filter(
      (x) =>
        (x.status === "proposed" || x.status === "confirmed") &&
        !todayIds.has(x.event.id),
    )
    .map((x) => x.event)
    .sort(bySlotTime);
  const past = withStatus
    .filter((x) => x.status === "happened" || x.status === "cancelled")
    .map((x) => x.event);

  const nothingActive = today.length === 0 && upcoming.length === 0;

  return (
    <>
      {nothingActive && (
        <Placeholder
          header="Поки жодного запланованого"
          description="Тапни «Новий івент» унизу — запропонуй дату, місце і збери своїх"
        >
          <span style={{ fontSize: 56 }}>🗓️</span>
        </Placeholder>
      )}
      <List style={{ paddingBottom: 128 }}>
        {today.length > 0 && (
          <Section header="Сьогодні" className="section-today">
            {today.map((event) => (
              <EventCell
                key={event.id}
                event={event}
                meId={meId}
                onOpen={onOpen}
                highlight
              />
            ))}
          </Section>
        )}
        {upcoming.length > 0 && (
          <Section header="Попереду">
            {upcoming.map((event) => (
              <EventCell
                key={event.id}
                event={event}
                meId={meId}
                onOpen={onOpen}
              />
            ))}
          </Section>
        )}
        {past.length > 0 && (
          <Section>
            <Cell
              style={{ color: "var(--tgui--hint_color)" }}
              after={
                <span
                  style={{
                    color: "var(--tgui--hint_color)",
                    display: "inline-block",
                    transition: "transform 0.2s",
                    transform: showPast ? "rotate(90deg)" : undefined,
                  }}
                >
                  ›
                </span>
              }
              onClick={() => setShowPast((v) => !v)}
            >
              Попередні івенти · {past.length}
            </Cell>
            {showPast &&
              past.map((event) => (
                <EventCell
                  key={event.id}
                  event={event}
                  meId={meId}
                  onOpen={onOpen}
                />
              ))}
          </Section>
        )}
      </List>
      <FixedLayout
        vertical="bottom"
        style={{
          padding:
            "12px 16px calc(12px + var(--tg-viewport-safe-area-inset-bottom, 0px))",
          background: "var(--tgui--secondary_bg_color)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <span
            role="button"
            onClick={onHowItWorks}
            style={{
              color: "var(--tgui--link_color)",
              fontSize: 16,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Як це працює?
          </span>
        </div>
        <Button size="l" stretched onClick={onCreate}>
          Новий івент
        </Button>
      </FixedLayout>
    </>
  );
}
