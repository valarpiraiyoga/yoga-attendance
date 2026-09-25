/**
 * Schedule Details and its edit step. Like the list page, Schedule Details draws the
 * compact page strip full-width, so it must sit directly in the shell's `<main>`:
 * this layout adds no container of its own. Each page sets its own content width
 * (Details wraps its body in `Container`; Edit is a centred `max-w-3xl` form).
 */
export default function ScheduleDetailsLayout({ children }) {
  return children;
}
