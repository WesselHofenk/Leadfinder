const isVerification = process.argv.includes("--verify");
const isTestEmail = process.argv.includes("--test-email");
const isStatusCheck = process.argv.includes("--status");
const isResend = process.argv.includes("--resend");
const isOutdatedWebsite = process.argv.includes("--outdated-website");
const isExtraOutdatedBatch = process.argv.includes("--extra-outdated-batch");
const resultFileArg = process.argv.find((argument) => argument.startsWith("--result-file="));
const resultFile = resultFileArg?.slice("--result-file=".length);
const cronSecret = process.env.CRON_SECRET;

if (!cronSecret) {
  throw new Error("CRON_SECRET is not available.");
}

const endpoint = new URL("https://leadfindersitora.nl/api/cron/outreach");
if (isVerification) {
  endpoint.searchParams.set("verify", "1");
}
if (isTestEmail) {
  endpoint.searchParams.set("test", "1");
}
if (isStatusCheck) {
  endpoint.searchParams.set("status", "1");
}
if (isResend) {
  endpoint.searchParams.set("resend", "1");
}
if (isOutdatedWebsite) {
  endpoint.searchParams.set("outdated", "1");
}
if (isExtraOutdatedBatch) {
  endpoint.searchParams.set("extraOutdated", "1");
}

async function main() {
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Outreach request failed (${response.status}): ${body}`);
  }

  console.log(`HTTP ${response.status}`);
  console.log(body || '{"status":"empty_response"}');
  if (resultFile) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(resultFile, JSON.stringify({ status: response.status, body }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
