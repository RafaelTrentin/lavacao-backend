// Manual pickup is negotiated outside the application, per product policy.
// Derive this from existing fields; do not rewrite historical monetary snapshots.
export function searchFeePolicy(appointment: { willSearchVehicle: boolean; searchType?: string | null }) {
  return {
    searchFeeStatus: !appointment.willSearchVehicle ? 'NOT_APPLICABLE' as const
      : appointment.searchType === 'MANUAL_ADDRESS' ? 'TO_CONFIRM_EXTERNALLY' as const
        : 'CALCULATED' as const,
  };
}
