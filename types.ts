
export interface PatientProfile {
  name: string;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  conditions: string[];
  custom_thresholds?: {
    heart_rate_max?: number;
    heart_rate_min?: number;
    spo2_min?: number;
    temp_max?: number;
  };
}

export interface ConsentState {
  has_accepted_disclaimer: boolean;
  data_sharing_enabled: boolean;
  timestamp?: number;
}

export interface VitalsReading {
  id: string;
  timestamp: number;
  heart_rate: number;
  body_temperature: number;
  spo2: number;
  battery_level: number;
  patient_id: string;
}

export interface LocationEntry {
  id: string;
  lat: number;
  lng: number;
  timestamp: number;
}

export interface GeofenceSettings {
  enabled: boolean;
  radius_meters: number;
  center: { lat: number; lng: number };
}

export enum DeviceConnectionStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  OFFLINE_FALLBACK = 'OFFLINE_FALLBACK',
  SYNCING = 'SYNCING'
}

export interface DeviceHealth {
  status: DeviceConnectionStatus;
  last_heartbeat: number;
  sensor_error: boolean;
  battery_low: boolean;
  local_alarm_active: boolean; 
  queued_packets: number;      
}

export enum AlertSeverity {
  CRITICAL = 'CRITICAL',
  WARNING = 'WARNING',
  STABLE = 'STABLE'
}

export enum AlertType {
  THRESHOLD = 'THRESHOLD',
  TREND = 'TREND',
  SOS = 'SOS',
  GEOFENCE = 'GEOFENCE',
  HARDWARE = 'HARDWARE',
  NETWORK = 'NETWORK'
}

export enum AlertStatus {
  ACTIVE = 'ACTIVE',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED'
}

export enum EscalationLevel {
  PRIMARY = 1,
  SECONDARY = 2,
  EMERGENCY_SERVICES = 3
}

export interface AlertAction {
  timestamp: number;
  action: string;
  actor: string;
}

export interface HealthAlert {
  id: string;
  timestamp: number;
  vitals_id?: string;
  location_id?: string;
  severity: AlertSeverity;
  type: AlertType;
  message: string;
  guidance?: string;
  acknowledged: boolean;
  acknowledged_at?: number;
  is_offline_event?: boolean;
  status: AlertStatus;
  vitals_snapshot?: Partial<VitalsReading>;
  actions: AlertAction[];
}

export interface GuardianState {
  is_notified: boolean;
  active_level: EscalationLevel;
  notification_timestamp?: number;
  acknowledged: boolean;
  escalation_timer: number;
  is_escalated_to_services: boolean;
  incident_cause?: string;
}

export interface ApiLogEntry {
  id: string;
  timestamp: number;
  method: 'POST' | 'GET' | 'PUT' | 'DELETE';
  endpoint: string;
  status: number;
  payload: any;
  response: any;
}
