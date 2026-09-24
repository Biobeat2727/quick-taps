export const runtime = 'nodejs';

import { simulatePool } from '@/lib/physics/simulate-pool';
import type { PoolShotParams } from '@/types/pool';

export async function POST(request: Request) {
  const params = await request.json() as PoolShotParams;
  const recording = await simulatePool(params);
  return Response.json(recording);
}
