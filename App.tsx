
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { Simulator } from './components/Simulator';
import { BackendDocs } from './components/BackendDocs';
import { AlertCenter } from './components/AlertCenter';
import { ProfileSettings } from './components/ProfileSettings';
import { ConsentModal } from './components/ConsentModal';
import { AlertHistory } from './components/AlertHistory';
import { SafetyZone } from './components/SafetyZone';
import { VitalsReading, HealthAlert, ApiLogEntry, GuardianState, AlertSeverity, EscalationLevel, LocationEntry, DeviceConnectionStatus, DeviceHealth, PatientProfile, ConsentState, AlertType, AlertStatus, GeofenceSettings } from './types';
import { db } from './services/mockDatabase';
import { processVitals, createSOSAlert, processLocationBreach, createDisconnectAlert } from './services/alertEngine';
import { ESCALATION_CONFIG, GEOFENCE_CONFIG } from './constants';
// Fix: Import GoogleGenAI from @google/genai
import { GoogleGenAI } from "@google/genai";

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'simulator' | 'docs' | 'profile' | 'safety'>('dashboard');
  const [vitals, setVitals] = useState<VitalsReading[]>([]);
  const [locations, setLocations] = useState<LocationEntry[]>([]);
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [consent, setConsent] = useState<ConsentState | null>(null);
  
  // Geofence Settings State
  const [geofenceSettings, setGeofenceSettings] = useState<GeofenceSettings>({
    enabled: true,
    radius_meters: GEOFENCE_CONFIG.DEFAULT_SAFE_RADIUS_KM * 1000,
    center: GEOFENCE_CONFIG.HOME
  });

  // State for Gemini-powered insights
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  
  // Offline Resilience State
  const [offlineQueue, setOfflineQueue] = useState<{vitals: VitalsReading[], locations: LocationEntry[]}>({ vitals: [], locations: [] });
  
  const [deviceHealth, setDeviceHealth] = useState<DeviceHealth>({
    status: DeviceConnectionStatus.CONNECTED,
    last_heartbeat: Date.now(),
    sensor_error: false,
    battery_low: false,
    local_alarm_active: false,
    queued_packets: 0
  });
  
  const [guardian, setGuardian] = useState<GuardianState>({
    is_notified: false,
    active_level: EscalationLevel.PRIMARY,
    acknowledged: false,
    escalation_timer: ESCALATION_CONFIG.LEVEL_TIMEOUT,
    is_escalated_to_services: false
  });

  const heartbeatRef = useRef<number>(Date.now());
  const isSyncingRef = useRef<boolean>(false);

  // Gemini AI Guidance Generator
  const generateAiInsight = useCallback(async (alert: HealthAlert, currentProfile: PatientProfile | null) => {
    if (!process.env.API_KEY) return;
    
    setIsAiLoading(true);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const prompt = `As a medical monitoring assistant for VitalShield, analyze this health alert and provide empathetic, non-diagnostic guidance for the guardian.
    
    Patient Context:
    - Name: ${currentProfile?.name || 'Patient'}
    - Conditions: ${currentProfile?.conditions.join(', ') || 'No known conditions'}
    
    Current Alert:
    - Incident: ${alert.message}
    - Type: ${alert.type}
    - Severity: ${alert.severity}
    
    Task: Provide 3 clear, actionable "next steps" for the guardian. Return as a simple list. No diagnosis.`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      setAiInsight(response.text || null);
    } catch (error) {
      console.error("Gemini AI error:", error);
      setAiInsight("Follow standard safety protocols.");
    } finally {
      setIsAiLoading(false);
    }
  }, []);

  // Initialization
  useEffect(() => {
    const fetchData = async () => {
      const [v, l, a, p, c] = await Promise.all([
        db.getVitals(),
        db.getLocations(),
        db.getAlerts(),
        db.getProfile(),
        db.getConsent()
      ]);
      setVitals([...v]);
      setLocations([...l]);
      setAlerts([...a]);
      setProfile(p);
      setConsent(c);
      setLogs([...db.getLogs()]);
    };
    fetchData();
  }, []);

  // Sync Engine
  useEffect(() => {
    const handleSync = async () => {
      if (deviceHealth.status === DeviceConnectionStatus.CONNECTED && (offlineQueue.vitals.length > 0 || offlineQueue.locations.length > 0) && !isSyncingRef.current) {
        isSyncingRef.current = true;
        setDeviceHealth(prev => ({ ...prev, status: DeviceConnectionStatus.SYNCING }));
        
        db.logApi({
          id: 'sync-' + Date.now(),
          timestamp: Date.now(),
          method: 'POST',
          endpoint: '/api/v1/sync/bulk',
          status: 200,
          payload: { queue_size: offlineQueue.vitals.length + offlineQueue.locations.length },
          response: { status: "SYNC_COMPLETE", packets_processed: offlineQueue.vitals.length + offlineQueue.locations.length }
        });

        setVitals(prev => [...prev, ...offlineQueue.vitals].slice(-50));
        setLocations(prev => [...prev, ...offlineQueue.locations].slice(-50));
        
        setOfflineQueue({ vitals: [], locations: [] });
        setDeviceHealth(prev => ({ ...prev, status: DeviceConnectionStatus.CONNECTED, queued_packets: 0, local_alarm_active: false }));
        setLogs([...db.getLogs()]);
        isSyncingRef.current = false;
      }
    };

    const interval = setInterval(handleSync, 3000);
    return () => clearInterval(interval);
  }, [deviceHealth.status, offlineQueue]);

  // Watchdog
  useEffect(() => {
    const watchdog = setInterval(() => {
      const elapsed = Date.now() - heartbeatRef.current;
      if (elapsed > ESCALATION_CONFIG.HEARTBEAT_TIMEOUT_MS && deviceHealth.status !== DeviceConnectionStatus.DISCONNECTED) {
        setDeviceHealth(prev => ({ ...prev, status: DeviceConnectionStatus.DISCONNECTED }));
        const alert = createDisconnectAlert(profile || undefined);
        handleTriggerEscalation(alert);
      }
    }, 5000);
    return () => clearInterval(watchdog);
  }, [deviceHealth.status, profile]);

  // Escalation Countdown
  useEffect(() => {
    let interval: any;
    if (guardian.is_notified && !guardian.acknowledged) {
      if (guardian.escalation_timer > 0) {
        interval = setInterval(() => {
          setGuardian(prev => ({ ...prev, escalation_timer: prev.escalation_timer - 1 }));
        }, 1000);
      } else if (guardian.active_level < EscalationLevel.EMERGENCY_SERVICES) {
          const nextLevel = (guardian.active_level + 1) as EscalationLevel;
          setGuardian(prev => ({
            ...prev,
            active_level: nextLevel,
            escalation_timer: ESCALATION_CONFIG.LEVEL_TIMEOUT,
            is_escalated_to_services: nextLevel === EscalationLevel.EMERGENCY_SERVICES
          }));
          
          setAlerts(prev => prev.map(a => {
            if (!a.acknowledged && a.severity === AlertSeverity.CRITICAL) {
              return {
                ...a,
                status: AlertStatus.ESCALATED,
                actions: [...a.actions, {
                  timestamp: Date.now(),
                  action: `Auto-escalated to Tier ${nextLevel}`,
                  actor: 'System Timer'
                }]
              };
            }
            return a;
          }));

          db.logApi({
            id: Math.random().toString(36).substr(2, 9),
            timestamp: Date.now(),
            method: 'POST',
            endpoint: '/api/v1/dispatch/escalate',
            status: 200,
            payload: { reason: "TIMEOUT", level: nextLevel },
            response: { status: "DISPATCHED" }
          });
          setLogs([...db.getLogs()]);
      }
    }
    return () => clearInterval(interval);
  }, [guardian.is_notified, guardian.acknowledged, guardian.escalation_timer, guardian.active_level]);

  const handleTriggerEscalation = useCallback(async (newAlert: HealthAlert) => {
    const enrichedAlert: HealthAlert = {
      ...newAlert,
      status: AlertStatus.ACTIVE,
      vitals_snapshot: vitals.length > 0 ? vitals[vitals.length-1] : undefined,
      actions: [{
        timestamp: Date.now(),
        action: 'Alert triggered by system monitor',
        actor: 'Safety Layer'
      }]
    };

    await db.saveAlert(enrichedAlert);
    setAlerts(prev => [...prev, enrichedAlert]);
    
    if (enrichedAlert.severity !== AlertSeverity.STABLE) {
      generateAiInsight(enrichedAlert, profile);
    }

    if (enrichedAlert.severity === AlertSeverity.CRITICAL && !guardian.is_notified) {
      setGuardian({
        is_notified: true,
        active_level: EscalationLevel.PRIMARY,
        notification_timestamp: Date.now(),
        acknowledged: false,
        escalation_timer: ESCALATION_CONFIG.LEVEL_TIMEOUT,
        is_escalated_to_services: false,
        incident_cause: enrichedAlert.type
      });

      db.logApi({
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        method: 'POST',
        endpoint: '/api/v1/notifications/start',
        status: 200,
        payload: { alert_id: enrichedAlert.id },
        response: { message: "Chain active." }
      });
      setLogs([...db.getLogs()]);
    }
  }, [guardian.is_notified, generateAiInsight, profile, vitals]);

  const handlePostLocation = useCallback(async (loc: LocationEntry, isNetDown: boolean) => {
    heartbeatRef.current = Date.now();
    
    if (isNetDown) {
      setDeviceHealth(prev => ({ ...prev, status: DeviceConnectionStatus.OFFLINE_FALLBACK, queued_packets: prev.queued_packets + 1, last_heartbeat: Date.now() }));
      setOfflineQueue(prev => ({ ...prev, locations: [...prev.locations, loc] }));
      
      const breachAlert = geofenceSettings.enabled ? processLocationBreach(loc, geofenceSettings.radius_meters, profile || undefined) : null;
      if (breachAlert) {
        breachAlert.is_offline_event = true;
        setDeviceHealth(prev => ({ ...prev, local_alarm_active: true }));
        handleTriggerEscalation(breachAlert);
        db.logApi({ id: 'sms-' + Date.now(), timestamp: Date.now(), method: 'POST', endpoint: '/api/v1/offline/sms-gateway', status: 202, payload: { alert_id: breachAlert.id, message: breachAlert.message }, response: { status: "SMS_DISPATCHED" } });
      }
    } else {
      setDeviceHealth(prev => ({ ...prev, status: DeviceConnectionStatus.CONNECTED, last_heartbeat: Date.now() }));
      const saved = await db.saveLocation(loc);
      setLocations(prev => [...prev, saved].slice(-50));
      if (geofenceSettings.enabled) {
        const breachAlert = processLocationBreach(loc, geofenceSettings.radius_meters, profile || undefined);
        if (breachAlert) handleTriggerEscalation(breachAlert);
      }
      db.logApi({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), method: 'POST', endpoint: '/api/v1/location', status: 201, payload: loc, response: { status: "OK" } });
    }
    setLogs([...db.getLogs()]);
  }, [geofenceSettings, handleTriggerEscalation, profile]);

  const handlePostVitals = useCallback(async (reading: VitalsReading, isNetDown: boolean) => {
    heartbeatRef.current = Date.now();

    // Update comprehensive device health
    setDeviceHealth(prev => ({
      ...prev,
      last_heartbeat: Date.now(),
      sensor_error: reading.heart_rate === 0 && reading.battery_level > 0,
      battery_low: reading.battery_level < 20
    }));

    if (isNetDown) {
      setDeviceHealth(prev => ({ ...prev, status: DeviceConnectionStatus.OFFLINE_FALLBACK, queued_packets: prev.queued_packets + 1 }));
      setOfflineQueue(prev => ({ ...prev, vitals: [...prev.vitals, reading] }));
      
      const history = [...vitals, ...offlineQueue.vitals];
      const newAlert = processVitals(reading, history, profile || undefined);
      
      if (newAlert) {
        newAlert.is_offline_event = true;
        setDeviceHealth(prev => ({ ...prev, local_alarm_active: true }));
        handleTriggerEscalation(newAlert);
        db.logApi({ id: 'sms-' + Date.now(), timestamp: Date.now(), method: 'POST', endpoint: '/api/v1/offline/sms-gateway', status: 202, payload: { alert_id: newAlert.id, message: newAlert.message }, response: { status: "SMS_DISPATCHED" } });
      }
    } else {
      setDeviceHealth(prev => ({ ...prev, status: DeviceConnectionStatus.CONNECTED }));
      const saved = await db.saveReading(reading);
      const history = await db.getVitals();
      const newAlert = processVitals(reading, history, profile || undefined);
      if (newAlert) handleTriggerEscalation(newAlert);
      db.logApi({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), method: 'POST', endpoint: '/api/v1/vitals', status: 201, payload: reading, response: { status: "success" } });
      setVitals(prev => [...prev, saved].slice(-20));
    }
    setLogs([...db.getLogs()]);
  }, [profile, vitals, offlineQueue.vitals, handleTriggerEscalation]);

  const handleSOS = useCallback(async (isNetDown: boolean) => {
    heartbeatRef.current = Date.now();
    const alert = createSOSAlert(profile || undefined);
    if (isNetDown) {
      alert.is_offline_event = true;
      setDeviceHealth(prev => ({ ...prev, local_alarm_active: true }));
      db.logApi({ id: 'sms-' + Date.now(), timestamp: Date.now(), method: 'POST', endpoint: '/api/v1/offline/sms-gateway', status: 202, payload: { alert_id: alert.id, type: "SOS" }, response: { status: "SMS_SENT" } });
    }
    handleTriggerEscalation(alert);
    setActiveTab('dashboard');
    setLogs([...db.getLogs()]);
  }, [handleTriggerEscalation, profile]);

  const handleGuardianAck = useCallback(async () => {
    setGuardian(prev => ({ ...prev, acknowledged: true }));
    const unackedAlerts = alerts.filter(a => !a.acknowledged);
    
    for (const alert of unackedAlerts) {
      await db.acknowledgeAlert(alert.id);
      setAlerts(prev => prev.map(a => a.id === alert.id ? {
        ...a,
        status: AlertStatus.RESOLVED,
        acknowledged: true,
        acknowledged_at: Date.now(),
        actions: [...a.actions, {
          timestamp: Date.now(),
          action: 'Incident Resolved',
          actor: `Guardian (Tier ${guardian.active_level})`
        }]
      } : a));
    }
    
    setDeviceHealth(prev => ({ ...prev, local_alarm_active: false }));
    setAiInsight(null); 
    db.logApi({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), method: 'PUT', endpoint: '/api/v1/alerts/acknowledge', status: 200, payload: { responder: guardian.active_level }, response: { status: "ACK_RECEIVED" } });
    setLogs([...db.getLogs()]);
  }, [alerts, guardian.active_level]);

  const handleProfileUpdate = async (p: PatientProfile) => {
    const updated = await db.saveProfile(p);
    setProfile(updated);
    db.logApi({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), method: 'PUT', endpoint: '/api/v1/profile', status: 200, payload: p, response: { status: "OK" } });
    setLogs([...db.getLogs()]);
  };

  const handleConsentUpdate = async (c: ConsentState) => {
    const updated = await db.saveConsent(c);
    setConsent(updated);
  };

  if (!consent || !consent.has_accepted_disclaimer) {
    return <ConsentModal onAccept={handleConsentUpdate} />;
  }

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab} logs={logs}>
      <div className="flex flex-col lg:flex-row gap-6 p-4">
        <div className="flex-1 space-y-6">
          {activeTab === 'dashboard' && <Dashboard vitals={vitals} alerts={alerts} locations={locations} deviceHealth={deviceHealth} profile={profile} />}
          {activeTab === 'safety' && (
            <SafetyZone 
              settings={geofenceSettings} 
              onUpdateSettings={(s) => setGeofenceSettings(prev => ({ ...prev, ...s }))}
              latestLocation={locations.length > 0 ? locations[locations.length - 1] : null}
              activeAlerts={alerts.filter(a => !a.acknowledged)}
            />
          )}
          {activeTab === 'history' && <AlertHistory alerts={alerts} />}
          {activeTab === 'simulator' && (
            <Simulator 
              onSendVitals={handlePostVitals} 
              onSendLocation={handlePostLocation} 
              onSOS={handleSOS} 
              geofenceEnabled={geofenceSettings.enabled}
              onToggleGeofence={() => setGeofenceSettings(prev => ({ ...prev, enabled: !prev.enabled }))}
              isConnected={deviceHealth.status !== DeviceConnectionStatus.DISCONNECTED}
              networkStatus={deviceHealth.status}
            />
          )}
          {activeTab === 'docs' && <BackendDocs />}
          {activeTab === 'profile' && profile && <ProfileSettings profile={profile} onSave={handleProfileUpdate} />}
        </div>
        <div className="w-full lg:w-96 shrink-0 space-y-6">
          <div className="space-y-4">
            <AlertCenter guardian={guardian} alerts={alerts.filter(a => !a.acknowledged)} onAck={handleGuardianAck} />
            
            {guardian.is_notified && !guardian.acknowledged && (
              <div className="bg-white rounded-xl shadow-lg border border-indigo-200 overflow-hidden animate-in slide-in-from-right duration-500">
                <div className="bg-indigo-600 px-4 py-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-white uppercase tracking-widest flex items-center">
                    <span className="w-1.5 h-1.5 bg-white rounded-full mr-2 animate-pulse"></span>
                    Gemini Intelligence
                  </span>
                  {isAiLoading && <span className="text-[10px] text-indigo-200 animate-pulse">Processing...</span>}
                </div>
                <div className="p-4">
                  {aiInsight ? (
                    <div className="text-xs text-slate-700 leading-relaxed font-medium">
                      <p className="mb-2 text-indigo-600 font-bold uppercase text-[9px]">Empathetic Guidance:</p>
                      <div className="whitespace-pre-wrap">{aiInsight}</div>
                    </div>
                  ) : (
                    <div className="py-4 text-center">
                      <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Generating AI Insights</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-sm font-semibold text-slate-700">Live API Traffic</h3>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Terminal</span>
            </div>
            <div className="p-2 h-[450px] overflow-y-auto space-y-2 bg-slate-900 mono">
              {logs.map(log => (
                <div key={log.id} className="text-[11px] border-b border-slate-800 pb-2 p-1">
                  <div className="flex justify-between">
                    <span className={`font-bold ${log.status >= 400 ? 'text-red-400' : (log.status === 202 ? 'text-amber-400' : 'text-green-400')}`}>
                      {log.method} {log.endpoint}
                    </span>
                    <span className="text-slate-600">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-1 text-slate-400 text-[10px] overflow-hidden text-ellipsis italic">Res: {JSON.stringify(log.response)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default App;
