export const nowIso = () => new Date().toISOString();

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatDateInput(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function startOfDayIso(date: string) {
  return new Date(`${date}T00:00:00`).toISOString();
}

export function endOfDayIso(date: string) {
  return new Date(`${date}T23:59:59.999`).toISOString();
}
