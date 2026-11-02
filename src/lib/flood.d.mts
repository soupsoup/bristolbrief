export type StagePoint = {
  time: string;
  stage: number;
};

export type BristolAlert = {
  id: string;
  event: string;
  headline: string;
  area: string;
  sent: string | null;
  expires: string | null;
  ends: string | null;
  description: string;
  forecastText: string;
  impactsText: string;
  reportedStage: number | null;
  reportedStageText: string;
  crestStage: number | null;
  crestTiming: string;
};

export const TAUNTON_USGS_SITE_ID: string;
export const TAUNTON_NWPS_GAUGE_ID: string;
export const TAUNTON_FLOOD_STAGE_FT: number;
export function extractUsgsObservations(payload: unknown): StagePoint[];
export function extractNwpsForecast(payload: unknown): { issuedAt: string | null; points: StagePoint[] };
export function extractNwpsObservations(payload: unknown): StagePoint[];
export function parseNwsFloodDetails(description?: string): Pick<BristolAlert, 'forecastText' | 'impactsText' | 'reportedStage' | 'reportedStageText' | 'crestStage' | 'crestTiming'>;
export function isRelevantBristolAlert(feature: unknown): boolean;
export function extractBristolAlerts(payload: unknown): BristolAlert[];
export function findTauntonFloodWarning(alerts: BristolAlert[]): BristolAlert | null;
