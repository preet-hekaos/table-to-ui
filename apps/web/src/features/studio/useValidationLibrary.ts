import { useQuery } from '@tanstack/react-query'
import { studio } from '@/api/endpoints'

/** The ready-made rules (Email, PAN, Pincode and so on). They rarely change, so they are kept for the session. */
export function useValidationLibrary() {
  return useQuery({ queryKey: ['studio-validation-library'], queryFn: studio.validationLibrary, staleTime: Infinity })
}
