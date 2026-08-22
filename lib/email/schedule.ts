import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const COLD_EMAIL_WINDOW_START_MINUTE = 9 * 60;
export const COLD_EMAIL_WINDOW_END_MINUTE = 17 * 60;
export const COLD_EMAIL_DAILY_LIMIT = 30;
export const COLD_EMAIL_INITIAL_DAILY = COLD_EMAIL_DAILY_LIMIT;
export const COLD_EMAIL_WEEKLY_INCREMENT = 0;
export const COLD_EMAIL_MAX_DAILY = COLD_EMAIL_DAILY_LIMIT;

export function coldEmailCampaignWeek(dayKey: string, startDayKey: string) {
  const elapsedDays = differenceInCalendarDays(parseISO(dayKey), parseISO(startDayKey));
  return elapsedDays < 0 ? 0 : Math.floor(elapsedDays / 7) + 1;
}

export function coldEmailDailyLimit(dayKey: string, startDayKey: string) {
  const week = coldEmailCampaignWeek(dayKey, startDayKey);
  return week === 0 ? 0 : COLD_EMAIL_DAILY_LIMIT;
}

export function localDayKey(date: Date, timeZone: string) {
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd");
}

export function nextDayKey(dayKey: string) {
  return format(addDays(parseISO(dayKey), 1), "yyyy-MM-dd");
}

export function coldEmailSlot(dayKey: string, slotIndex: number, dailyLimit: number, timeZone: string) {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= dailyLimit) throw new Error("Ongeldig e-mailslot.");
  const windowMinutes = COLD_EMAIL_WINDOW_END_MINUTE - COLD_EMAIL_WINDOW_START_MINUTE;
  const minuteOfDay = COLD_EMAIL_WINDOW_START_MINUTE + Math.floor(((slotIndex + 0.5) * windowMinutes) / dailyLimit);
  const hours = Math.floor(minuteOfDay / 60).toString().padStart(2, "0");
  const minutes = (minuteOfDay % 60).toString().padStart(2, "0");
  return fromZonedTime(`${dayKey}T${hours}:${minutes}:00`, timeZone);
}

export function zonedDayBounds(dayKey: string, timeZone: string) {
  return {
    start: fromZonedTime(`${dayKey}T00:00:00`, timeZone),
    end: fromZonedTime(`${nextDayKey(dayKey)}T00:00:00`, timeZone),
  };
}

export function immediateColdEmailAllowed(now: Date, warmupStart: string, timeZone: string) {
  return localDayKey(now, timeZone) < warmupStart;
}

export function withinColdEmailWindow(now: Date, timeZone: string) {
  const hours = Number(formatInTimeZone(now, timeZone, "H"));
  const minutes = Number(formatInTimeZone(now, timeZone, "m"));
  const minuteOfDay = hours * 60 + minutes;
  return minuteOfDay >= COLD_EMAIL_WINDOW_START_MINUTE && minuteOfDay < COLD_EMAIL_WINDOW_END_MINUTE;
}
