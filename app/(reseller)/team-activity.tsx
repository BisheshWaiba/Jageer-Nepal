// app/(reseller)/team-activity.tsx
// Team Activity now lives inside the Team hub (employees.tsx) as its Activity
// tab. This route stays so old links and bookmarks still land in the right place.
import { Redirect } from 'expo-router';

export default function TeamActivityRedirect() {
  return <Redirect href={'/(reseller)/employees?tab=activity' as any} />;
}
