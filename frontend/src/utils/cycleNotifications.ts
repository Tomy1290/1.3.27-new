import { AppState } from '../state/types';
import { predictNextStart, getFertileWindow, getOvulationDate } from '../logic/cycle';
import { scheduleOneTimeNotification, cancelExistingCycleNotifications } from './notifications';
import { t } from '../i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cycle_notifications';

export interface CycleNotification {
  id: string;
  type: 'period' | 'fertile_start' | 'fertile_end' | 'ovulation' | 'health_check';
  notificationId: string;
  scheduledDate: Date;
}

/**
 * Hilfsfunktion: stellt sicher, dass nur wirklich zukünftige Zeiten geplant werden.
 * - Vergangene Zeiten → null
 * - <20s in der Zukunft → automatisch +2 Minuten verschieben
 */
function safeFutureDate(date: Date): Date | null {
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return null; // Vergangenheit → ignorieren
  if (diff < 20_000) {
    // zu nah → +2 Minuten
    return new Date(date.getTime() + 2 * 60 * 1000);
  }
  return date;
}

export async function scheduleCycleNotifications(state: AppState): Promise<void> {
  try {
    console.log('📅 Scheduling automatic cycle notifications...');
    await cancelExistingCycleNotifications();

    if (!state.cycles || state.cycles.length === 0) {
      console.log('⚠️ No cycle data available, skipping cycle notifications');
      return;
    }

    const language = state.language || 'de';
    const out: CycleNotification[] = [];

    // Periode
    const next = predictNextStart(state.cycles);
    if (next) {
      const periodDay = safeFutureDate(new Date(next.getFullYear(), next.getMonth(), next.getDate(), 9, 0, 0));
      if (periodDay) {
        const [title, body] = t(language, 'period_today');
        const id = await scheduleOneTimeNotification(title, body, periodDay, 'cycle');
        if (id) out.push({ id: `period_today_${Date.now()}`, type: 'period', notificationId: id, scheduledDate: periodDay });
      }
      const periodPrev = safeFutureDate(new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1, 20, 0, 0));
      if (periodPrev) {
        const [title, body] = t(language, 'period_tomorrow');
        const id = await scheduleOneTimeNotification(title, body, periodPrev, 'cycle');
        if (id) out.push({ id: `period_tomorrow_${Date.now()}`, type: 'period', notificationId: id, scheduledDate: periodPrev });
      }
    }

    // Fruchtbare Phase + Eisprung
    const fertile = getFertileWindow(state.cycles);
    if (fertile) {
      const start = safeFutureDate(new Date(fertile.start.getFullYear(), fertile.start.getMonth(), fertile.start.getDate(), 9, 0, 0));
      if (start) {
        const [title, body] = t(language, 'fertile_start');
        const id = await scheduleOneTimeNotification(title, body, start, 'cycle');
        if (id) out.push({ id: `fertile_start_${Date.now()}`, type: 'fertile_start', notificationId: id, scheduledDate: start });
      }
      const ovu = getOvulationDate(state.cycles);
      if (ovu) {
        const ov = safeFutureDate(new Date(ovu.getFullYear(), ovu.getMonth(), ovu.getDate(), 10, 0, 0));
        if (ov) {
          const [title, body] = t(language, 'ovulation');
          const id = await scheduleOneTimeNotification(title, body, ov, 'cycle');
          if (id) out.push({ id: `ovulation_${Date.now()}`, type: 'ovulation', notificationId: id, scheduledDate: ov });
        }
      }
      const end = safeFutureDate(new Date(fertile.end.getFullYear(), fertile.end.getMonth(), fertile.end.getDate(), 18, 0, 0));
      if (end) {
        const [title, body] = t(language, 'fertile_end');
        const id = await scheduleOneTimeNotification(title, body, end, 'cycle');
        if (id) out.push({ id: `fertile_end_${Date.now()}`, type: 'fertile_end', notificationId: id, scheduledDate: end });
      }
    }

    // Wöchentlicher Health Check (immer nächster Sonntag 11:00)
    const nextSunday = new Date();
    const day = nextSunday.getDay();
    const add = (7 - day) % 7 || 7; // nächster Sonntag (nicht heute)
    nextSunday.setDate(nextSunday.getDate() + add);
    nextSunday.setHours(11, 0, 0, 0);
    const hc = safeFutureDate(nextSunday);
    if (hc) {
      const [title, body] = t(language, 'health_check');
      const healthId = await scheduleOneTimeNotification(title, body, hc, 'cycle');
      if (healthId) out.push({ id: `health_check_${Date.now()}`, type: 'health_check', notificationId: healthId, scheduledDate: hc });
    }

    storeCycleNotifications(out);
    console.log(`✅ Scheduled ${out.length} cycle notifications`);
  } catch (e) {
    console.error('❌ Error scheduling cycle notifications:', e);
  }
}

export async function updateCycleNotifications(state: AppState): Promise<void> {
  await scheduleCycleNotifications(state);
}

export async function getStoredCycleNotifications(): Promise<CycleNotification[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data) as CycleNotification[];
    return parsed.map(n => ({ ...n, scheduledDate: new Date(n.scheduledDate) }));
  } catch (e) {
    console.error('❌ Error loading cycle notifications:', e);
    return [];
  }
}

function storeCycleNotifications(notifications: CycleNotification[]): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
}
