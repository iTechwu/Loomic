import { ssoProfileEmail } from "../sso-identity-email.js";
import type { DatabasePool } from "./pool.js";

export type SsoIdentityRepository = {
  resolve(input: { email?: string; ssoUserId: string }): Promise<string>;
};

/**
 * Resolves SSO subjects to application profile IDs without making the identity
 * provider a dependency of the product database. The one-time email lookup is
 * solely for legacy TOS/CDN profile continuity; every subsequent request uses
 * the durable SSO subject mapping.
 */
export function createSsoIdentityRepository(
  pool: DatabasePool,
): SsoIdentityRepository {
  return {
    async resolve({ email, ssoUserId }) {
      return pool.transaction(async (client) => {
        const existing = await client.query<{ data_user_id: string }>(
          "select data_user_id from sso_user_mappings where sso_user_id = $1",
          [ssoUserId],
        );
        if (existing.rowCount && existing.rows[0]) {
          return existing.rows[0].data_user_id;
        }

        const candidates = email
          ? await client.query<{ id: string }>(
              "select id from profiles where lower(email) = lower($1) limit 2",
              [email],
            )
          : { rowCount: 0, rows: [] as { id: string }[] };
        const dataUserId =
          candidates.rowCount === 1 && candidates.rows[0]
            ? candidates.rows[0].id
            : ssoUserId;
        await client.query(
          `insert into sso_user_mappings (sso_user_id, data_user_id, mapping_source, matched_email)
           values ($1, $2, $3, $4)
           on conflict (sso_user_id) do update set matched_email = excluded.matched_email`,
          [
            ssoUserId,
            dataUserId,
            dataUserId === ssoUserId ? "new_sso_user" : "legacy_email_match",
            ssoProfileEmail(ssoUserId, email),
          ],
        );
        console.info("[sso-identity] resolved subject", {
          dataUserId,
          source:
            dataUserId === ssoUserId ? "new_sso_user" : "legacy_email_match",
          ssoUserId,
        });
        return dataUserId;
      });
    },
  };
}
