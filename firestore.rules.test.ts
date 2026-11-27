/**
 * Payload-First Security Spec Test Matrix for /callCounters/{userId}
 * Validates structural invariants for Dirty Dozen adversarial payloads.
 */

export interface DirtyDozenCase {
  name: string;
  userIdPath: string;
  authUid: string | null;
  emailVerified: boolean;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    name: '1. Unauthenticated create',
    userIdPath: 'userA',
    authUid: null,
    emailVerified: false,
    operation: 'create',
    payload: { userId: 'userA', totalCallsAttempted: 1 },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '2. Unverified email write',
    userIdPath: 'userA',
    authUid: 'userA',
    emailVerified: false,
    operation: 'create',
    payload: { userId: 'userA', totalCallsAttempted: 1 },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '3. Cross-user get',
    userIdPath: 'userB',
    authUid: 'userA',
    emailVerified: true,
    operation: 'get',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '4. Cross-user update',
    userIdPath: 'userB',
    authUid: 'userA',
    emailVerified: true,
    operation: 'update',
    payload: { busy: 2 },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '5. Identity spoofing in userId field',
    userIdPath: 'userA',
    authUid: 'userA',
    emailVerified: true,
    operation: 'create',
    payload: { userId: 'userB', totalCallsAttempted: 0 },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '6. Shadow update with ghost field',
    userIdPath: 'userA',
    authUid: 'userA',
    emailVerified: true,
    operation: 'update',
    payload: { busy: 1, isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '7. Unauthorized collection list',
    userIdPath: '',
    authUid: 'userA',
    emailVerified: true,
    operation: 'list',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '8. Negative counter poisoning',
    userIdPath: 'userA',
    authUid: 'userA',
    emailVerified: true,
    operation: 'update',
    payload: { busy: -1 },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '9. Type poisoning (string instead of int)',
    userIdPath: 'userA',
    authUid: 'userA',
    emailVerified: true,
    operation: 'update',
    payload: { connectCall: '10' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '10. Immutable createdAt tampering',
    userIdPath: 'userA',
    authUid: 'userA',
    emailVerified: true,
    operation: 'update',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '11. Client timestamp forgery on updatedAt',
    userIdPath: 'userA',
    authUid: 'userA',
    emailVerified: true,
    operation: 'update',
    payload: { busy: 1, updatedAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '12. Invalid path ID characters',
    userIdPath: 'bad$id!invalid',
    authUid: 'bad$id!invalid',
    emailVerified: true,
    operation: 'get',
    expected: 'PERMISSION_DENIED',
  },
];
