/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, RefreshCw } from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  doc,
  getDoc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  auth,
  clampCount,
  db,
  googleProvider,
  handleFirestoreError,
  isValidUserId,
  MAX_COUNTER_VALUE,
  OperationType,
} from './firebase';

type CounterField =
  | 'totalCallsAttempted'
  | 'connectCall'
  | 'activeCall'
  | 'followupCall'
  | 'busy'
  | 'switchedOff';

interface CounterConfig {
  label: string;
  field: CounterField;
}

const COUNTER_CONFIGS: readonly CounterConfig[] = [
  { label: 'Total Calls Attempted', field: 'totalCallsAttempted' },
  { label: 'Connect call', field: 'connectCall' },
  { label: 'Active call', field: 'activeCall' },
  { label: 'followup call', field: 'followupCall' },
  { label: 'Busy', field: 'busy' },
  { label: 'Switched Off', field: 'switchedOff' },
] as const;

type CountsState = Record<CounterField, number>;

const EMPTY_COUNTS: CountsState = {
  totalCallsAttempted: 0,
  connectCall: 0,
  activeCall: 0,
  followupCall: 0,
  busy: 0,
  switchedOff: 0,
};

const LOCAL_STORAGE_PREFIX = 'call_counters_v1_';

function getStorageKey(uid: string | null): string {
  return `${LOCAL_STORAGE_PREFIX}${uid ?? 'guest'}`;
}

function readLocalCounts(uid: string | null): CountsState {
  try {
    const raw = window.localStorage.getItem(getStorageKey(uid));
    if (!raw) return { ...EMPTY_COUNTS };
    const parsed = JSON.parse(raw) as Partial<Record<CounterField, unknown>>;
    return {
      totalCallsAttempted: clampCount(parsed.totalCallsAttempted),
      connectCall: clampCount(parsed.connectCall),
      activeCall: clampCount(parsed.activeCall),
      followupCall: clampCount(parsed.followupCall),
      busy: clampCount(parsed.busy),
      switchedOff: clampCount(parsed.switchedOff),
    };
  } catch {
    return { ...EMPTY_COUNTS };
  }
}

function writeLocalCounts(uid: string | null, counts: CountsState): void {
  try {
    window.localStorage.setItem(getStorageKey(uid), JSON.stringify(counts));
  } catch {
    // Ignore storage quota errors
  }
}

function extractCountsFromDoc(data: Record<string, unknown>): CountsState {
  return {
    totalCallsAttempted: clampCount(data.totalCallsAttempted),
    connectCall: clampCount(data.connectCall),
    activeCall: clampCount(data.activeCall),
    followupCall: clampCount(data.followupCall),
    busy: clampCount(data.busy),
    switchedOff: clampCount(data.switchedOff),
  };
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [counts, setCounts] = useState<CountsState>(() => readLocalCounts(null));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRefreshConfirm, setShowRefreshConfirm] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [fatalError, setFatalError] = useState<Error | null>(null);

  const remoteDocExistsRef = useRef<boolean>(false);
  const countsRef = useRef<CountsState>(counts);

  useEffect(() => {
    countsRef.current = counts;
  }, [counts]);

  // Listen to Firebase Auth state (persisted in IndexedDB across power/network drops)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      remoteDocExistsRef.current = false;
      const localCached = readLocalCounts(nextUser ? nextUser.uid : null);
      setCounts(localCached);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to user's Firestore counter document once authenticated
  useEffect(() => {
    if (!authReady || !user || !isValidUserId(user.uid)) {
      return;
    }

    const docPath = `callCounters/${user.uid}`;
    const docRef = doc(db, 'callCounters', user.uid);

    const unsubscribe = onSnapshot(
      docRef,
      { includeMetadataChanges: false },
      (snapshot) => {
        if (snapshot.exists()) {
          remoteDocExistsRef.current = true;
          const nextCounts = extractCountsFromDoc(snapshot.data());
          setCounts(nextCounts);
          writeLocalCounts(user.uid, nextCounts);
        } else {
          remoteDocExistsRef.current = false;
        }
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, docPath);
        } catch (wrapped) {
          setFatalError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    );

    return () => unsubscribe();
  }, [authReady, user]);

  // Close confirmation modal on Escape
  useEffect(() => {
    if (!showRefreshConfirm) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowRefreshConfirm(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showRefreshConfirm]);

  const updateCounterDelta = useCallback(
    async (field: CounterField, delta: 1 | -1) => {
      const currentVal = countsRef.current[field];
      if (delta === 1 && currentVal >= MAX_COUNTER_VALUE) {
        return;
      }
      if (delta === -1 && currentVal <= 0) {
        return;
      }

      const nextCounts: CountsState = {
        ...countsRef.current,
        [field]: clampCount(currentVal + delta),
      };

      // Persist immediately in UI and localStorage so zero clicks are lost on power/network loss
      setCounts(nextCounts);
      writeLocalCounts(user ? user.uid : null, nextCounts);

      if (!user || !isValidUserId(user.uid)) {
        return;
      }

      const docPath = `callCounters/${user.uid}`;
      const docRef = doc(db, 'callCounters', user.uid);

      try {
        if (!remoteDocExistsRef.current) {
          remoteDocExistsRef.current = true;
          await setDoc(docRef, {
            userId: user.uid,
            totalCallsAttempted: clampCount(nextCounts.totalCallsAttempted),
            connectCall: clampCount(nextCounts.connectCall),
            activeCall: clampCount(nextCounts.activeCall),
            followupCall: clampCount(nextCounts.followupCall),
            busy: clampCount(nextCounts.busy),
            switchedOff: clampCount(nextCounts.switchedOff),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(docRef, {
            [field]: increment(delta),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        try {
          handleFirestoreError(error, OperationType.WRITE, docPath);
        } catch (wrapped) {
          setFatalError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    },
    [user]
  );

  const handleConfirmRefresh = useCallback(async () => {
    setShowRefreshConfirm(false);
    setIsRefreshing(true);

    const resetCounts: CountsState = { ...EMPTY_COUNTS };
    setCounts(resetCounts);
    writeLocalCounts(user ? user.uid : null, resetCounts);

    try {
      if (user && isValidUserId(user.uid)) {
        const docPath = `callCounters/${user.uid}`;
        const docRef = doc(db, 'callCounters', user.uid);
        try {
          if (!remoteDocExistsRef.current) {
            remoteDocExistsRef.current = true;
            await setDoc(docRef, {
              userId: user.uid,
              totalCallsAttempted: 0,
              connectCall: 0,
              activeCall: 0,
              followupCall: 0,
              busy: 0,
              switchedOff: 0,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await updateDoc(docRef, {
              totalCallsAttempted: 0,
              connectCall: 0,
              activeCall: 0,
              followupCall: 0,
              busy: 0,
              switchedOff: 0,
              updatedAt: serverTimestamp(),
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, docPath);
        }
      }
    } catch (error) {
      setFatalError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      window.setTimeout(() => {
        setIsRefreshing(false);
      }, 200);
    }
  }, [user]);

  const handleSignIn = useCallback(async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const signedInUser = result.user;
      if (signedInUser && isValidUserId(signedInUser.uid)) {
        const docPath = `callCounters/${signedInUser.uid}`;
        const docRef = doc(db, 'callCounters', signedInUser.uid);
        try {
          const existingSnap = await getDoc(docRef);
          if (!existingSnap.exists()) {
            const guestCounts = readLocalCounts(null);
            remoteDocExistsRef.current = true;
            await setDoc(docRef, {
              userId: signedInUser.uid,
              totalCallsAttempted: clampCount(guestCounts.totalCallsAttempted),
              connectCall: clampCount(guestCounts.connectCall),
              activeCall: clampCount(guestCounts.activeCall),
              followupCall: clampCount(guestCounts.followupCall),
              busy: clampCount(guestCounts.busy),
              switchedOff: clampCount(guestCounts.switchedOff),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            setCounts(guestCounts);
            writeLocalCounts(signedInUser.uid, guestCounts);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, docPath);
        }
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setFatalError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy]);

  const handleSignOut = useCallback(async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      await signOut(auth);
    } catch (error) {
      setFatalError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy]);

  if (fatalError) {
    throw fatalError;
  }

  return (
    <main className="min-h-screen w-full bg-black text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-5xl flex items-center justify-end gap-3 mb-8">
        <button
          type="button"
          onClick={() => setShowRefreshConfirm(true)}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 bg-neutral-900 hover:bg-neutral-800 active:scale-[0.98] text-white text-sm font-medium rounded-lg border border-neutral-800 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white whitespace-nowrap shrink-0"
        >
          <RefreshCw
            className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>Refresh</span>
        </button>

        {authReady && (
          user ? (
            <button
              type="button"
              onClick={handleSignOut}
              disabled={authBusy}
              className="min-h-[44px] px-4 py-2 bg-neutral-900 hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-60 text-white text-sm font-medium rounded-lg border border-neutral-800 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white whitespace-nowrap shrink-0"
            >
              Sign out
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={authBusy}
              className="min-h-[44px] px-4 py-2 bg-white hover:bg-neutral-200 active:scale-[0.98] disabled:opacity-60 text-black text-sm font-medium rounded-lg transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white whitespace-nowrap shrink-0"
            >
              Sign in with Google
            </button>
          )
        )}
      </div>

      <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {COUNTER_CONFIGS.map(({ label, field }) => {
          const count = counts[field];
          return (
            <div key={field} className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => void updateCounterDelta(field, 1)}
                className="w-full min-h-[48px] px-5 py-3 bg-neutral-900 hover:bg-neutral-800 active:scale-[0.98] text-white text-base font-medium rounded-lg border border-neutral-800 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white whitespace-nowrap"
              >
                {label}
              </button>
              <div className="flex items-center justify-center gap-4">
                <div
                  aria-label={`${label} count`}
                  className="text-3xl font-semibold tabular-nums text-white min-w-[2ch] text-center"
                >
                  {count}
                </div>
                <button
                  type="button"
                  onClick={() => void updateCounterDelta(field, -1)}
                  disabled={count <= 0}
                  aria-label={`Remove 1 from ${label}`}
                  className="inline-flex items-center justify-center gap-1 min-h-[40px] min-w-[44px] px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 active:scale-[0.97] disabled:opacity-30 disabled:pointer-events-none text-neutral-200 hover:text-white text-sm font-medium rounded-lg border border-neutral-800 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white whitespace-nowrap shrink-0"
                >
                  <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>1</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showRefreshConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowRefreshConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="refresh-confirm-title"
            aria-describedby="refresh-confirm-desc"
            className="w-full max-w-sm bg-neutral-950 border border-neutral-800 rounded-xl p-6 flex flex-col gap-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-2">
              <h2 id="refresh-confirm-title" className="text-lg font-semibold text-white">
                Refresh data?
              </h2>
              <p id="refresh-confirm-desc" className="text-sm text-neutral-400">
                This will delete your current counts and reset every counter to 0.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowRefreshConfirm(false)}
                className="min-h-[44px] px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-medium rounded-lg border border-neutral-800 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRefresh()}
                className="min-h-[44px] px-4 py-2 bg-white hover:bg-neutral-200 text-black text-sm font-medium rounded-lg transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white whitespace-nowrap"
              >
                Confirm Refresh
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
