
export const MEDICAL_THRESHOLDS = {
  HEART_RATE: {
    MIN: 40,
    MAX: 130,
    UNIT: 'BPM'
  },
  BODY_TEMP: {
    MIN: 35.0,
    MAX: 39.5,
    UNIT: '°C'
  },
  SPO2: {
    MIN: 90,
    UNIT: '%'
  },
  BATTERY: {
    MIN: 15, // Percent
    UNIT: '%'
  }
};

export const ESCALATION_CONFIG = {
  LEVEL_TIMEOUT: 20, 
  TREND_WINDOW_SIZE: 5,
  HEARTBEAT_TIMEOUT_MS: 30000, // 30 seconds for disconnection check
  CONTACTS: {
    LEVEL_1: "Primary: Alice (Spouse)",
    LEVEL_2: "Secondary: Bob (Son)",
    LEVEL_3: "EMERGENCY SERVICES (911)"
  }
};

export const GEOFENCE_CONFIG = {
  HOME: { lat: 37.7749, lng: -122.4194 }, 
  DEFAULT_SAFE_RADIUS_KM: 0.5, 
};
