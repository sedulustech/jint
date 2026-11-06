/**
 * Prints tarball downloads from the Analytics Engine dataset `jint_downloads`, by day, channel and
 * version. Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token with "Account Analytics:
 * Read"). Usage: bun scripts/downloads.ts [days=7]
 *
 * Sums double1 rather than counting rows, because Analytics Engine samples at high volume.
 */
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (account === undefined || token === undefined) {
  console.error("set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
  process.exit(2);
}
const days = Number(process.argv[2] ?? 7);
if (!Number.isInteger(days) || days < 1 || days > 90) {
  console.error("days must be an integer from 1 to 90");
  process.exit(2);
}
const sql = `
  SELECT toDate(timestamp) AS day, blob1 AS channel, blob2 AS version, SUM(_sample_interval * double1) AS downloads
  FROM jint_downloads
  WHERE timestamp > NOW() - INTERVAL '${days}' DAY
  GROUP BY day, channel, version
  ORDER BY day DESC, downloads DESC
  FORMAT TSV`;
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
  { method: "POST", headers: { authorization: `Bearer ${token}` }, body: sql },
);
if (!response.ok) {
  console.error(`query failed: ${response.status} ${await response.text()}`);
  process.exit(1);
}
console.log("day\tchannel\tversion\tdownloads");
console.log((await response.text()).trimEnd());
