/* Calendar engine: builds the day-by-day model for a given month,
 * marking weekends, holidays and "ponto facultativo" from the yearly
 * calendar file (maintained by the coordinator). */

const MONTH_NAMES = [
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
];

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

async function loadCalendar(year) {
  const res = await fetch(`data/calendar-${year}.json`);
  if (!res.ok) throw new Error(`Calendar file for ${year} not found`);
  return res.json();
}

/* Returns [{day, weekday, kind, label}] where kind is one of:
 * 'workday' | 'saturday' | 'sunday' | 'feriado' | 'ponto_facultativo' */
function buildMonth(calendar, year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const weekday = date.getDay();
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const holiday = calendar.holidays[iso];
    let kind = 'workday';
    let label = '';
    if (holiday) {
      kind = holiday.type;
      label = holiday.type === 'feriado' ? 'FERIADO' : 'PONTO FACULTATIVO';
    } else if (weekday === 6) {
      kind = 'saturday';
      label = 'SÁBADO';
    } else if (weekday === 0) {
      kind = 'sunday';
      label = 'DOMINGO';
    }
    days.push({ day, weekday, weekdayKey: WEEKDAY_KEYS[weekday], kind, label });
  }
  return days;
}

/* Applies a preceptor's weekly pattern to a month model.
 * pattern: { mon: {exp1: {in, out, local}, exp2: {...}}, tue: ..., ... }
 * Only 'workday' days receive shifts; the preceptor can then deselect days. */
function applyPattern(monthDays, pattern) {
  return monthDays.map((d) => {
    const shifts = d.kind === 'workday' ? pattern[d.weekdayKey] || null : null;
    return { ...d, shifts, selected: !!shifts };
  });
}

function shiftHours(shift) {
  if (!shift) return 0;
  let total = 0;
  if (shift.exp1) total += shift.exp1.out - shift.exp1.in;
  if (shift.exp2) total += shift.exp2.out - shift.exp2.in;
  return total;
}

function totalHours(days) {
  return days
    .filter((d) => d.selected && d.shifts)
    .reduce((sum, d) => sum + shiftHours(d.shifts), 0);
}
