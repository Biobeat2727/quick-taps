export const runtime = 'nodejs';

import { simulateBowl } from '@/lib/physics/simulate-bowling';
import type { ThrowParams } from '@/types/bowling';

export async function POST(request: Request) {
  const params = await request.json() as ThrowParams;
  const recording = await simulateBowl(params);
  return Response.json(recording);
}
