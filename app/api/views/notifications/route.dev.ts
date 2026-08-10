import { NextResponse } from "next/server";
import { notificationsView } from "../../../../lib/views/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * See `app/api/views/agents/route.ts` for what this family is and is not.
 *
 * Worth one extra sentence here (MAR-588): what this returns holds a masked hint
 * and two switches, and never the channel address. `notificationsView` does not
 * open the vault, so this developer-path route is not a way to read a credential
 * out of a browser tab — the same standing the `view.notifications` entry in
 * `lib/shell/read.ts` claims for the packaged path.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(notificationsView());
}
