import { formatTimeParts } from "@/lib/format";

/**
 * The start-time tile: a session's strongest visual element - the time large and bold,
 * its period small beneath (finalized reference). It is the mark of a session the way
 * `BatchAvatar` is the mark of a batch: the Attendance session card and the Session
 * Details header both use it.
 *
 * @param {object} props
 * @param {string} props.startTime - the raw "HH:MM" / "HH:MM:SS" start time.
 * @param {string} props.label - the readable time (range), for assistive technology.
 */
export default function StartTimeTile({ startTime, label }) {
  const { time, period } = formatTimeParts(startTime);

  return (
    <span className="flex size-14 shrink-0 flex-col items-center justify-center rounded-lg bg-brand/10 text-center leading-none text-brand">
      <span className="sr-only">Starts at {label}</span>
      <span aria-hidden="true" className="text-section-title font-bold">
        {time}
      </span>
      <span aria-hidden="true" className="mt-0.5 text-small font-semibold">
        {period}
      </span>
    </span>
  );
}
