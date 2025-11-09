'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Navigation } from '@/components/layout/navigation';
import { PatientSummaryList } from '@/components/dashboard/patient-summary-list';
import type { Patient, Alert, TelemetryData } from '@/lib/types';
import { addPatient, seedInitialData } from '@/lib/data';
import { Skeleton } from '@/components/ui/skeleton';
import { useCollection, useFirebase, useMemoFirebase, WithId } from '@/firebase';
import { collection, updateDoc, doc } from 'firebase/firestore';
import { PatientRiskMatrix } from '@/components/dashboard/patient-risk-matrix';
import { SystemHealthSummary } from '@/components/dashboard/system-health-summary';
import { LiveVitalsChart } from '@/components/patient/live-vitals-chart';
import { PatientStressChart } from '@/components/dashboard/patient-stress-chart';
import { SystemWidgets } from '@/components/dashboard/system-widgets';

// Extended Patient type for client-side state simulation
type PatientWithCondition = WithId<Patient> & { condition: 'Stable' | 'Elevated' | 'Recovering' | 'Critical' };

// A more dynamic simulation with patient states
const simulateVitals = (patient: PatientWithCondition): PatientWithCondition => {
  let { bpm, stress, risk, condition, id } = patient;

  // Guarantee that the first two patients start and stay mostly stable
  if (id === 'p001' || id === 'p002') {
    if (Math.random() > 0.98) { // Very small chance to become elevated
      condition = 'Elevated';
    } else {
      condition = 'Stable';
    }
  } else {
    // State Transition Logic for other patients
    if (condition === 'Stable' && Math.random() < 0.03) { // 3% chance to become elevated
      condition = 'Elevated';
    } else if (condition === 'Elevated' && Math.random() < 0.05) { // 5% chance to become critical
      condition = 'Critical';
    } else if ((condition === 'Critical' || condition === 'Elevated') && Math.random() < 0.15) { // 15% chance to start recovering
      condition = 'Recovering';
    } else if (condition === 'Recovering' && bpm < 95) { // If recovered enough, become stable
      condition = 'Stable';
    }
  }


  // Vitals simulation based on state
  switch (condition) {
    case 'Stable':
      bpm += (Math.random() - 0.5) * 4; // Gentle drift: -2 to +2
      stress += (Math.random() - 0.5) * 6; // -3 to +3
      bpm = Math.max(75, Math.min(90, bpm)); // Clamp to a healthy range
      stress = Math.max(10, Math.min(40, stress));
      break;
    case 'Elevated':
      bpm += (Math.random() - 0.4) * 5; // Drift upwards: -2 to +3
      stress += (Math.random() - 0.4) * 8;
      bpm = Math.max(100, Math.min(120, bpm));
      stress = Math.max(40, Math.min(70, stress));
      break;
    case 'Recovering':
      bpm -= Math.random() * 3; // Trend downwards
      stress -= Math.random() * 4;
      bpm = Math.max(80, bpm);
      stress = Math.max(20, stress);
      break;
    case 'Critical':
      bpm += (Math.random() - 0.3) * 6; // Strong upwards drift
      stress += (Math.random() - 0.3) * 10;
      bpm = Math.max(120, Math.min(160, bpm));
      stress = Math.max(70, Math.min(100, stress));
      break;
  }

  // Generic vitals that are relatively stable
  const spo2 = patient.spo2 + (Math.random() - 0.5) * 1;
  const temp = patient.temp + (Math.random() - 0.5) * 0.1;
  
  // Risk gently trends towards a baseline based on overall vitals
  const baselineRisk = (stress / 200) + ((Math.max(0, bpm - 80)) / 100);
  risk = Math.max(0, Math.min(1, risk * 0.9 + baselineRisk * 0.1));

  return {
    ...patient,
    bpm: Math.round(bpm),
    stress: Math.round(stress),
    spo2: Math.round(Math.max(92, Math.min(99, spo2))),
    temp: parseFloat(temp.toFixed(1)),
    risk,
    condition,
    timestamp: new Date().toISOString(),
  };
};


export default function Home() {
  const [searchTerm, setSearchTerm] = useState('');
  const [liveTelemetry, setLiveTelemetry] = useState<WithId<TelemetryData>[]>([]);
  const [focusedPatient, setFocusedPatient] = useState<PatientWithCondition | null>(null);

  const { firestore } = useFirebase();
  const router = useRouter();

  const patientsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'patients');
  }, [firestore]);
  
  // Local state for patients will now include the 'condition'
  const [livePatients, setLivePatients] = useState<PatientWithCondition[]>([]);

  const { data: initialPatients, isLoading: isLoadingPatients, setData: setInitialPatients } = useCollection<Patient>(patientsQuery);

  useEffect(() => {
    if (firestore && isLoadingPatients === false && initialPatients && initialPatients.length === 0) {
      const seedData = async () => {
        console.log("No patients found. Seeding database with initial data...");
        const seededPatients = await seedInitialData(firestore);
        if (seededPatients.length > 0) {
            const patientsWithCondition = seededPatients.map(p => ({ ...p, condition: 'Stable' as const }));
            setInitialPatients(patientsWithCondition);
            setLivePatients(patientsWithCondition);
            if (!focusedPatient) {
                setFocusedPatient(patientsWithCondition[0]);
            }
        }
        console.log("Seeding complete.");
      };
      seedData();
    } else if (initialPatients && initialPatients.length > 0 && livePatients.length === 0) {
        // Initialize livePatients from Firestore data
        const patientsWithCondition = initialPatients.map(p => ({
            ...p,
            condition: p.risk > 0.7 ? 'Critical' : (p.risk > 0.4 ? 'Elevated' : 'Stable')
        } as PatientWithCondition));
        setLivePatients(patientsWithCondition);
        if (!focusedPatient) {
            setFocusedPatient(patientsWithCondition[0]);
        }
    }
  }, [firestore, initialPatients, isLoadingPatients, setInitialPatients, focusedPatient, livePatients.length]);

  const alertsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'alerts');
  }, [firestore]);

  const { data: alerts, isLoading: isLoadingAlerts } = useCollection<Alert>(alertsQuery);
  const isLoading = isLoadingPatients || isLoadingAlerts;

  // Live data simulation for ALL patients on the dashboard
  useEffect(() => {
    if (livePatients.length === 0 || !firestore) return;

    const intervalId = setInterval(() => {
      const updatedPatients = livePatients.map(p => {
        const newVitals = simulateVitals(p);
        const patientDocRef = doc(firestore, 'patients', p.id);
        // Update Firestore with only the serializable Patient data
        const { condition, ...patientData } = newVitals;
        // Non-blocking update to Firestore
        updateDoc(patientDocRef, patientData).catch(err => console.error("Firestore update failed:", err));
        return newVitals;
      });
      setLivePatients(updatedPatients);

      // Update focused patient and live telemetry for the chart
      const currentFocused = updatedPatients.find(p => p.id === focusedPatient?.id);
      if (currentFocused) {
          setFocusedPatient(currentFocused);
          setLiveTelemetry(prev => {
              const newEntry: WithId<TelemetryData> = {
                  id: currentFocused.timestamp,
                  patientId: currentFocused.id,
                  deviceId: currentFocused.deviceId,
                  ...currentFocused
              };
              const updatedTelemetry = [...prev, newEntry];
              return updatedTelemetry.slice(-30);
          });
      }

    }, 6000); // Update every 6 seconds

    return () => clearInterval(intervalId);
  }, [livePatients, firestore, focusedPatient?.id]);


  const handleAddPatient = async (newPatientInfo: Pick<Patient, 'name' | 'age' | 'gender' | 'ward' | 'admissionDate' | 'familyMemberEmail'>) => {
    if (!firestore ) return;
    const newPatientWithId = await addPatient(firestore, newPatientInfo);
    if (newPatientWithId) {
       const newLivePatient: PatientWithCondition = {...newPatientWithId, condition: 'Stable' };
       setLivePatients(prev => [...prev, newLivePatient]);
    }
  };
  
  const handleSelectPatientForChart = (patient: PatientWithCondition) => {
    setFocusedPatient(patient);
  };

  const handleSelectPatientForDetail = (patient: WithId<Patient>) => {
    router.push(`/patients/${patient.id}`);
  };

  const filteredPatients = useMemo(() => {
    return livePatients.filter(
      p => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  },[livePatients, searchTerm]);


  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <Header />
      <Navigation onSearch={setSearchTerm} onAddPatient={handleAddPatient} />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <div className="grid gap-4 md:gap-8">
          
          <div className="grid gap-4">
             <h2 className="font-heading text-2xl">Patient Overview</h2>
            {isLoading && livePatients.length === 0 ? (
              <div className="flex space-x-4">
                <Skeleton className="h-[140px] w-[280px] rounded-lg" />
                <Skeleton className="h-[140px] w-[280px] rounded-lg" />
                <Skeleton className="h-[140px] w-[280px] rounded-lg" />
              </div>
            ) : (
              <PatientSummaryList
                patients={filteredPatients}
                onSelectPatient={handleSelectPatientForChart}
                onDoubleClickPatient={handleSelectPatientForDetail}
                focusedPatientId={focusedPatient?.id}
              />
            )}
          </div>

          <SystemHealthSummary patients={livePatients || []} isLoading={isLoading} />
          
          {/* Live Charts Section */}
          <div className="grid gap-4 md:gap-8 lg:grid-cols-2">
             {isLoading || liveTelemetry.length === 0 ? (
                <Skeleton className="h-[250px] w-full" />
              ) : (
                <LiveVitalsChart telemetryHistory={liveTelemetry} />
              )}
              {isLoading || !livePatients ? (
                <Skeleton className="h-[250px] w-full" />
              ): (
                <PatientStressChart patients={livePatients} isLoading={isLoading} />
              )}
          </div>
          
          {/* Analytics Section */}
          <div className="grid gap-4 md:gap-8">
            <PatientRiskMatrix patients={livePatients || []} isLoading={isLoading} />
          </div>

          <SystemWidgets patients={livePatients || []} alerts={alerts || []} isLoading={isLoading} />

        </div>
      </main>
    </div>
  );
}
