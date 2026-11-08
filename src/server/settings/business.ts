import "server-only";
import type { Tx } from "@/server/db/pool";
import { parseSettings, type BusinessSettings } from "@/server/settings/schemas";

export type BusinessRecord = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  supportEmail: string | null;
  isDemo: boolean;
  settings: BusinessSettings;
};

/** Load the current tenant's business row. RLS guarantees it is the caller's. */
export async function loadBusiness(tx: Tx): Promise<BusinessRecord> {
  const row = await tx.one<{
    id: string;
    name: string;
    slug: string;
    timezone: string;
    support_email: string | null;
    is_demo: boolean;
    settings: unknown;
  }>("select id, name, slug, timezone, support_email, is_demo, settings from businesses where id = app.current_business_id()");
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    supportEmail: row.support_email,
    isDemo: row.is_demo,
    settings: parseSettings(row.settings),
  };
}
