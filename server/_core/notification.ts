export type NotificationPayload = {
  title: string;
  content: string;
};

// Push notification is not yet implemented outside Manus.
// Returns false (not delivered) instead of throwing, so callers can handle gracefully.
export async function notifyOwner(_payload: NotificationPayload): Promise<boolean> {
  console.warn("[Notification] notifyOwner is not configured in this environment.");
  return false;
}
