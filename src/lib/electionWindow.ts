import election from '../data/election.json';
import electionResults from '../data/election-results.json';

/** Where the site is relative to Election Day, as America/New_York calendar days. */
export function electionWindow(now = new Date()) {
  const todayET = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const days = Math.round((Date.parse(`${election.date}T00:00:00Z`) - Date.parse(`${todayET}T00:00:00Z`)) / 864e5);
  const live = Object.keys((electionResults as { races?: object }).races ?? {}).length > 0;
  return { days, live, show: days <= 7 && days >= -7 };
}
